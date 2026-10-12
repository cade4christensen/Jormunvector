import { snap, r, dist, perpDist, rdpSimplify,
         cubicB, quadB, computeNormals } from './math.js'
import { aiStyle, aiPath, aiLPath,
         aiCircle, aiSquare, aiRect, aiTriangle, aiStar, aiHeart, aiArrow,
         aiWave, aiSpiral, aiDiamond, aiHexagon, aiCross, aiMoon, aiMountain,
         aiSun, aiLine, aiCloud, aiLightning, aiLeaf, aiFlower, aiTree,
         aiHouse, aiFish, aiTadpole, aiFrog, aiCat, aiRabbit, aiMushroom,
         aiBird, aiFlame, aiGear, aiAnchor, aiPerson, aiSnake } from './ai-shapes.js'

// ── State ──────────────────────────────────────────────────────────────────
let tool         = 'segment'
let shapes       = []
let selected     = null
let selectedNode = null   // { shapeId, nodeIdx } — node focused for lock toggle
let nextId       = 1

// Drawing WIP state (line / curve / segment tools)
let wip      = null   // { mode: 'line'|'curve', points: [{x,y}], closed: bool }
let freehand = null   // { rawPts: [{x,y}] }  — freehand draw, simplified on mouseup

// Drag states
let eDrag    = null   // ellipse drag  { x0, y0 }
let rDrag    = null   // rect drag     { x0, y0 }
let nodeDrag = null   // node editing  { shapeId, kind: 'node'|'mid', idx }

// Expand-to-shape state
let expandMode     = 'uniform'   // 'uniform' | 'taper'
let expandStartCap = 'flat'      // 'flat' | 'round' | 'point'
let expandEndCap   = 'flat'

// AI key
let geminiKey = localStorage.getItem('jv_gemini_key') || ''

// Group state — paths whose endpoints snapped together share a group
let groups       = []   // [{ id, memberIds: [shapeId,...] }]
let nextGroupId  = 1
let wipSnapIds    = new Set()   // shape IDs snapped to during current drawing op
let lastSnapId    = null        // set by snapToNode on each hit
let lastSnapNodeIdx = null      // node index within the snapped shape
let wipFirstSnap  = null        // { shapeId, nodeIdx } — snap at first WIP point

let svgEl, wipLayer, editLayer, shapesLayer, canvasWrapper

// Undo / redo
let undoStack = []
let redoStack = []

// View transform (zoom / pan)
let viewTransform = { x: 0, y: 0, scale: 1 }
let isPanning  = false
let panStart   = null
let spaceDown  = false

// Background (canvas-area) pan drag
let areaDrag = null    // { x, y } — dragging the dark background to pan
let zcHovered = false  // true while mouse is over the zoom widget
const panKeys = new Set()  // arrow keys held while zoom widget hovered
let panRafId  = null

// Shape drag — move selected shape(s) on canvas
let shapeDrag = null   // { startPt, origMap: Map<id, clonedShape> }

// Resize drag — resize via bounding box handles
let resizeDrag = null  // { handleIdx, origBounds, origShapeData, shapeId }

// Snap to grid
let snapToGridEnabled = false
let gridSize = 10

// Multi-select
let multiSelected = new Set()
let marqueeDrag = null   // { x0, y0 } — rubber-band select in progress

// Clipboard for copy/paste
let clipboard = []

// ── Init ───────────────────────────────────────────────────────────────────
window.onload = () => {
  svgEl         = document.getElementById('svg-canvas')
  wipLayer      = document.getElementById('wip-layer')
  editLayer     = document.getElementById('edit-layer')
  shapesLayer   = document.getElementById('shapes-layer')
  canvasWrapper = document.getElementById('canvas-wrapper')

  svgEl.addEventListener('mousedown', onDown)
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup',   onUp)
  svgEl.addEventListener('dblclick',    onDblClick)
  svgEl.addEventListener('contextmenu', onRightClick)
  document.addEventListener('keydown',  onKey)
  document.addEventListener('keyup',   onKeyUp)

  // Zoom via mouse wheel on the canvas area
  const canvasArea = document.getElementById('canvas-area')
  canvasArea.addEventListener('wheel', onWheel, { passive: false })

  // Drag the dark background to pan
  canvasArea.addEventListener('mousedown', e => {
    if (e.button !== 0) return
    if (svgEl.contains(e.target)) return          // let SVG handle its own clicks
    if (e.target.closest('#zoom-controls')) return // don't pan from the widget
    areaDrag = { x: e.clientX, y: e.clientY }
    e.preventDefault()
  })
  // areaDrag mousemove/mouseup are now handled inside the main onMove/onUp

  // Track hover over zoom widget so arrow keys pan instead of nudge
  const zcEl = document.getElementById('zoom-controls')
  zcEl.addEventListener('mouseenter', () => { zcHovered = true })
  zcEl.addEventListener('mouseleave', () => { zcHovered = false; panKeys.clear() })

  // Colour the key button if a Gemini key is already saved
  if (geminiKey) {
    const btn = document.getElementById('ai-key-toggle')
    if (btn) { btn.style.color = '#4ade80'; btn.style.borderColor = '#4ade8066' }
  }

  tryAutoLoad()
  render()
}

// ── Tool ───────────────────────────────────────────────────────────────────
function setTool(t) {
  cancelWip()
  nodeDrag = null
  selectedNode = null
  tool = t
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'))
  const btn = document.getElementById('btn-' + t)
  if (btn) btn.classList.add('active')
  document.getElementById('status-tool').textContent = 'tool: ' + t
  const hints = {
    segment:  'click start point · click end point · done',
    line:     'click to place points · double-click, Enter or Esc to finish',
    curve:    'click to place smooth points · double-click, Enter or Esc to finish',
    ellipse:  'click + drag · hold Shift for circle',
    rect:     'click + drag · hold Shift for square',
    freehand: 'click + drag to draw freely · release to auto-simplify into editable nodes',
    select:   'click shape in list · drag green nodes to move · drag grey diamonds to curve a segment',
  }
  document.getElementById('status-hint').textContent = hints[t] || ''
  renderEditOverlay()
}

// ── SVG coordinate helper ──────────────────────────────────────────────────
function svgPt(e) {
  const rect = svgEl.getBoundingClientRect()
  let x = (e.clientX - rect.left) * (200 / rect.width)
  let y = (e.clientY - rect.top)  * (200 / rect.height)
  if (snapToGridEnabled && tool !== 'select') {
    x = Math.round(x / gridSize) * gridSize
    y = Math.round(y / gridSize) * gridSize
  } else {
    x = Math.round(x * 10) / 10
    y = Math.round(y * 10) / 10
  }
  return { x, y }
}

// Snap a point to the nearest existing anchor node within SNAP_DIST SVG units.
// Also sets lastSnapId to the owner shape's ID (null if no snap).
function snapToNode(pt) {
  const SNAP_DIST = 4
  for (const s of shapes) {
    if (!s.nodes) continue
    for (let i = 0; i < s.nodes.length; i++) {
      const nd = s.nodes[i]
      if (dist(pt, nd) < SNAP_DIST) {
        lastSnapId = s.id
        lastSnapNodeIdx = i
        return { x: nd.x, y: nd.y }
      }
    }
  }
  lastSnapId = null
  lastSnapNodeIdx = null
  return pt
}

// ── Mouse: down ────────────────────────────────────────────────────────────
function onDown(e) {
  if (e.button !== 0) return

  // ── Pan with Space held ──
  if (spaceDown) {
    isPanning = true
    panStart = { x: e.clientX, y: e.clientY }
    svgEl.classList.add('grabbing')
    return
  }

  const rawPt = svgPt(e)
  const pt = tool === 'select' ? rawPt : snapToNode(rawPt)
  if (lastSnapId !== null) wipSnapIds.add(lastSnapId)

  // ── Select / node-edit mode ──
  if (tool === 'select') {
    const selShape = shapes.find(s => s.id === selected)

    // Check node/CP handles FIRST — they take priority over resize handles
    if (selShape && selShape.type === 'path') {
      const handles = editHandles(selShape)
      for (const h of handles) {
        if (dist(pt, h) < 6) {
          if (h.kind === 'node') {
            selectedNode = { shapeId: selected, nodeIdx: h.idx }
            renderEditOverlay()
          }
          nodeDrag = { shapeId: selected, kind: h.kind, idx: h.idx }
          svgEl.classList.add('grabbing')
          return
        }
      }
    }

    // Check resize handles AFTER node handles (lower priority)
    if (selShape) {
      const b = getShapeBounds(selShape)
      if (b) {
        const rHandles = resizeHandlePositions(b)
        for (let hi = 0; hi < rHandles.length; hi++) {
          if (dist(pt, rHandles[hi]) < 5) {
            saveState()
            resizeDrag = { handleIdx: hi, origBounds: deepClone(b), origShapeData: deepClone(selShape), shapeId: selShape.id }
            svgEl.classList.add('grabbing')
            return
          }
        }
      }
    }

    // Hit-test all shapes (back-to-front), skip locked shapes
    const hit = [...shapes].reverse().find(s => !s.locked && hitTestShape(s, pt))
    if (hit) {
      if (e.shiftKey) {
        // Shift+click: toggle multi-select
        if (multiSelected.has(hit.id)) { multiSelected.delete(hit.id) }
        else { if (selected !== null) multiSelected.add(selected); multiSelected.add(hit.id) }
        selected = hit.id; selectedNode = null
        syncPropsPanel(hit)
        render()
      } else {
        // Regular click: select + start shape drag
        if (!multiSelected.has(hit.id)) multiSelected.clear()
        selected = hit.id; selectedNode = null
        syncPropsPanel(hit)
        saveState()
        // Build origMap for all selected shapes
        const targets = multiSelected.size > 0
          ? [...multiSelected, ...(multiSelected.has(hit.id) ? [] : [hit.id])]
          : [hit.id]
        const origMap = new Map()
        for (const id of targets) {
          const s = shapes.find(sh => sh.id === id)
          if (s && !s.locked) origMap.set(id, deepClone(s))
        }
        shapeDrag = { startPt: pt, origMap }
        svgEl.classList.add('grabbing')
        render()
      }
      return
    }

    // Clicked empty space — start marquee; defer deselect until mouseup
    if (!e.shiftKey) { multiSelected.clear(); selected = null; selectedNode = null }
    marqueeDrag = { x0: pt.x, y0: pt.y }
    render()
    return
  }

  // ── Freehand ──
  if (tool === 'freehand') { freehand = { rawPts: [pt] }; return }

  // ── Ellipse ──
  if (tool === 'ellipse') { eDrag = { x0: pt.x, y0: pt.y }; return }

  // ── Rect ──
  if (tool === 'rect') { rDrag = { x0: pt.x, y0: pt.y }; return }

  // ── Segment: 2-click auto-commit ──
  if (tool === 'segment') {
    if (!wip) {
      wip = { mode: 'line', points: [pt], closed: false }
      wipFirstSnap = lastSnapId !== null ? { shapeId: lastSnapId, nodeIdx: lastSnapNodeIdx } : null
    } else {
      wip.points.push(pt)
      commitPath()
      return
    }
    renderWip()
    return
  }

  // ── Line / Curve ──
  if (tool === 'line' || tool === 'curve') {
    if (!wip) {
      wip = { mode: tool, points: [pt], closed: false }
      wipFirstSnap = lastSnapId !== null ? { shapeId: lastSnapId, nodeIdx: lastSnapNodeIdx } : null
    } else {
      // Click on last placed point: commit open path
      if (wip.points.length >= 2 && dist(pt, wip.points[wip.points.length - 1]) < 7) {
        commitPath()
        return
      }
      // Click on first point (3+ points): close and commit
      if (wip.points.length >= 3 && dist(pt, wip.points[0]) < 7) {
        wip.closed = true
        commitPath()
        return
      }
      wip.points.push(pt)
    }
    renderWip()
  }
}

// ── Mouse: move ────────────────────────────────────────────────────────────
function onMove(e) {
  // Background pan (canvas-area drag outside SVG)
  if (areaDrag) {
    viewTransform.x += e.clientX - areaDrag.x
    viewTransform.y += e.clientY - areaDrag.y
    areaDrag = { x: e.clientX, y: e.clientY }
    applyViewTransform()
    return
  }
  // Space+drag pan mode
  if (isPanning && panStart) {
    viewTransform.x += e.clientX - panStart.x
    viewTransform.y += e.clientY - panStart.y
    panStart = { x: e.clientX, y: e.clientY }
    applyViewTransform()
    return
  }

  const pt = svgPt(e)
  document.getElementById('status-pos').textContent = `x: ${pt.x}  y: ${pt.y}`

  if (resizeDrag) { applyResizeDrag(pt); return }

  if (shapeDrag) { applyShapeDrag(pt); return }

  if (marqueeDrag) { renderMarquee(marqueeDrag.x0, marqueeDrag.y0, pt.x, pt.y); return }

  if (nodeDrag) {
    applyNodeDrag(pt)
    return
  }

  if (freehand) {
    const last = freehand.rawPts[freehand.rawPts.length - 1]
    if (dist(pt, last) > 1.5) freehand.rawPts.push(pt)
    renderFreehand()
    return
  }
  if (eDrag) { previewEllipse(eDrag.x0, eDrag.y0, pt.x, pt.y, e.shiftKey); return }
  if (rDrag) { previewRect(rDrag.x0, rDrag.y0, pt.x, pt.y, e.shiftKey);    return }
  if (wip)   { renderWip(pt) }
}

// ── Mouse: up ──────────────────────────────────────────────────────────────
function onUp(e) {
  if (e.button !== 0) return

  if (areaDrag) { areaDrag = null; return }

  if (isPanning) {
    isPanning = false; panStart = null
    svgEl.classList.remove('grabbing')
    return
  }

  if (resizeDrag) {
    resizeDrag = null
    svgEl.classList.remove('grabbing')
    autoSave()
    return
  }

  if (shapeDrag) {
    shapeDrag = null
    svgEl.classList.remove('grabbing')
    autoSave()
    return
  }

  if (marqueeDrag) {
    const pt = svgPt(e)
    const rx0 = Math.min(marqueeDrag.x0, pt.x), ry0 = Math.min(marqueeDrag.y0, pt.y)
    const rx1 = Math.max(marqueeDrag.x0, pt.x), ry1 = Math.max(marqueeDrag.y0, pt.y)
    marqueeDrag = null
    wipLayer.innerHTML = ''
    // Only treat as marquee if the box has meaningful size
    if (rx1 - rx0 > 2 || ry1 - ry0 > 2) {
      const hits = shapes.filter(s => !s.hidden && !s.locked && shapeBoundsIntersects(s, rx0, ry0, rx1, ry1))
      if (hits.length) {
        hits.forEach(s => multiSelected.add(s.id))
        selected = hits[hits.length - 1].id
        syncPropsPanel(shapes.find(s => s.id === selected))
      }
    }
    render()
    return
  }

  if (nodeDrag) {
    nodeDrag = null
    svgEl.classList.remove('grabbing')
    return
  }

  if (freehand) {
    commitFreehand()
    return
  }

  const pt = svgPt(e)

  if (eDrag) {
    let rx = Math.abs(pt.x - eDrag.x0) / 2
    let ry = Math.abs(pt.y - eDrag.y0) / 2
    if (e.shiftKey) { const s = Math.min(rx, ry); rx = s; ry = s }
    const cx = r((eDrag.x0 + pt.x) / 2)
    const cy = r((eDrag.y0 + pt.y) / 2)
    eDrag = null
    if (rx > 0.5 && ry > 0.5) commitShape({ type: 'ellipse', cx, cy, rx: r(rx), ry: r(ry), ...getProps() })
    wipLayer.innerHTML = ''
    return
  }

  if (rDrag) {
    let w = Math.abs(pt.x - rDrag.x0)
    let h = Math.abs(pt.y - rDrag.y0)
    if (e.shiftKey) { const s = Math.min(w, h); w = s; h = s }
    const x = r(Math.min(rDrag.x0, pt.x))
    const y = r(Math.min(rDrag.y0, pt.y))
    rDrag = null
    if (w > 0.5 && h > 0.5) commitShape({ type: 'rect', x, y, w: r(w), h: r(h), ...getProps() })
    wipLayer.innerHTML = ''
  }
}

// ── Double-click: finish path or insert node ──────────────────────────────
function onDblClick(e) {
  if ((tool === 'line' || tool === 'curve') && wip) {
    if (wip.points.length > 2) wip.points.pop()
    if (wip.points.length >= 2) commitPath()
    else cancelWip()
    return
  }
  // In select mode: double-click on a selected path to insert a node
  if (tool === 'select' && selected !== null) {
    const shape = shapes.find(s => s.id === selected)
    if (shape && shape.type === 'path' && shape.nodes) {
      const pt = svgPt(e)
      const segIdx = findSegmentAt(shape, pt)
      if (segIdx !== -1) {
        saveState()
        insertNodeOnSegment(shape, segIdx)
        render()
      }
    }
  }
}

function onRightClick(e) {
  e.preventDefault()
  if (wip && wip.points.length >= 2) commitPath()
  else cancelWip()
}

// ── WIP rendering ──────────────────────────────────────────────────────────
function renderWip(cursor) {
  if (!wip) { wipLayer.innerHTML = ''; return }
  const pts = cursor ? [...wip.points, cursor] : wip.points
  const d   = smoothPathD(pts, false)

  let html = `<path d="${d}" fill="none" stroke="#4ade80" stroke-width="0.8"
    stroke-dasharray="3 2" opacity="0.7" stroke-linecap="round"/>`

  wip.points.forEach((p, i) => {
    html += `<circle cx="${p.x}" cy="${p.y}" r="${i === 0 ? 2.5 : 1.8}"
      fill="${i === 0 ? '#4ade80' : '#09090b'}" stroke="#4ade80" stroke-width="0.8"/>`
  })
  if (cursor) {
    html += `<circle cx="${cursor.x}" cy="${cursor.y}" r="1.5"
      fill="none" stroke="#4ade8055" stroke-width="0.8"/>`
  }
  wipLayer.innerHTML = html
}

function previewEllipse(x0, y0, x1, y1, shift) {
  let rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2
  if (shift) { const s = Math.min(rx, ry); rx = s; ry = s }
  wipLayer.innerHTML = `<ellipse cx="${(x0+x1)/2}" cy="${(y0+y1)/2}" rx="${rx}" ry="${ry}"
    fill="none" stroke="#4ade80" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.7"/>`
}

function previewRect(x0, y0, x1, y1, shift) {
  let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
  if (shift) { const s = Math.min(w, h); w = s; h = s }
  const x = Math.min(x0, x1), y = Math.min(y0, y1)
  wipLayer.innerHTML = `<rect x="${x}" y="${y}" width="${w}" height="${h}"
    fill="none" stroke="#4ade80" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.7"/>`
}

// ── Path math (string helpers for WIP preview) ─────────────────────────────
function linePathD(pts, closed) {
  if (!pts.length) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`
  return closed ? d + ' Z' : d
}

function smoothPathD(pts, closed) {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : ''
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
  const t = 0.4, n = pts.length
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i]
    const p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)]
    d += ` C ${r(p1.x + (p2.x - p0.x) * t / 3)} ${r(p1.y + (p2.y - p0.y) * t / 3)},`
       + ` ${r(p2.x - (p3.x - p1.x) * t / 3)} ${r(p2.y - (p3.y - p1.y) * t / 3)},`
       + ` ${p2.x} ${p2.y}`
  }
  return closed ? d + ' Z' : d
}

// ── Rich path model ────────────────────────────────────────────────────────
// Path shapes store: nodes [{x,y}], segs [null,'L'|'Q'|'C',...], cps [null, ...]
// This lets us edit nodes and bend segments after drawing.

function pathD(shape) {
  if (shape.d) return shape.d   // raw d string (expanded shapes)
  const { nodes, segs, cps, closed } = shape
  if (!nodes || !nodes.length) return ''
  let d = `M ${nodes[0].x} ${nodes[0].y}`
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i]
    if (segs[i] === 'Q' && cps[i]) {
      d += ` Q ${r(cps[i].cx)} ${r(cps[i].cy)}, ${n.x} ${n.y}`
    } else if (segs[i] === 'C' && cps[i]) {
      const { cp1x, cp1y, cp2x, cp2y } = cps[i]
      d += ` C ${r(cp1x)} ${r(cp1y)}, ${r(cp2x)} ${r(cp2y)}, ${n.x} ${n.y}`
    } else {
      d += ` L ${n.x} ${n.y}`
    }
  }
  return closed ? d + ' Z' : d
}

// ── Path tangent helper — returns outgoing direction from an endpoint ────────
// atLastNode=true  → tangent leaving the last node (forward direction out of path)
// atLastNode=false → tangent leaving the first node (backward direction out of path)
function getPathEndTangent(shape, atLastNode) {
  const { nodes, segs, cps } = shape
  if (!nodes || nodes.length < 2) return null
  const n = nodes.length
  if (atLastNode) {
    const last = nodes[n - 1]
    if (segs[n - 1] === 'C' && cps[n - 1]) {
      const cp2 = cps[n - 1]
      return { dx: last.x - cp2.cp2x, dy: last.y - cp2.cp2y }
    }
    const prev = nodes[n - 2]
    return { dx: last.x - prev.x, dy: last.y - prev.y }
  } else {
    const first = nodes[0]
    if (segs[1] === 'C' && cps[1]) {
      const cp1 = cps[1]
      // Outgoing from first node going backward = opposite of path's forward tangent
      return { dx: first.x - cp1.cp1x, dy: first.y - cp1.cp1y }
    }
    const next = nodes[1]
    return { dx: first.x - next.x, dy: first.y - next.y }
  }
}

// ── Commit ─────────────────────────────────────────────────────────────────
function commitPath() {
  if (!wip || wip.points.length < 2) { cancelWip(); return }

  const { mode, points, closed } = wip
  const nodes = points.map(p => ({ x: p.x, y: p.y, locked: false }))
  const segs  = [null]
  const cps   = [null]
  const n     = nodes.length

  // Always use smooth Catmull-Rom C segments — no sharp corners
  const t = 0.4
  for (let i = 1; i < n; i++) {
    const p0 = nodes[Math.max(0, i - 2)]
    const p1 = nodes[i - 1]
    const p2 = nodes[i]
    const p3 = nodes[Math.min(n - 1, i + 1)]
    segs.push('C')
    cps.push({
      cp1x: r(p1.x + (p2.x - p0.x) * t / 3),
      cp1y: r(p1.y + (p2.y - p0.y) * t / 3),
      cp2x: r(p2.x - (p3.x - p1.x) * t / 3),
      cp2y: r(p2.y - (p3.y - p1.y) * t / 3),
    })
  }

  // G1 continuity: if the first WIP point snapped to an existing path's endpoint,
  // adjust cp1 of the first segment to match the connected path's outgoing tangent.
  if (wipFirstSnap && segs.length > 1 && segs[1] === 'C') {
    const conn = shapes.find(s => s.id === wipFirstSnap.shapeId)
    if (conn && conn.nodes && conn.segs) {
      const ni = wipFirstSnap.nodeIdx
      const atLast = (ni === conn.nodes.length - 1)
      const atFirst = (ni === 0)
      if (atLast || atFirst) {
        const tangent = getPathEndTangent(conn, atLast)
        if (tangent) {
          const len = Math.sqrt(tangent.dx * tangent.dx + tangent.dy * tangent.dy)
          if (len > 0.01) {
            const scale = dist(nodes[0], nodes[1]) * t
            cps[1] = {
              ...cps[1],
              cp1x: r(nodes[0].x + (tangent.dx / len) * scale),
              cp1y: r(nodes[0].y + (tangent.dy / len) * scale),
            }
          }
        }
      }
    }
  }

  commitShape({ type: 'path', nodes, segs, cps, closed, ...getProps() })
}

function commitShape(shape) {
  saveState()
  shape.id = nextId++
  shapes.push(shape)
  selected = shape.id
  const connectedIds = new Set(wipSnapIds)   // save before cancelWip clears wipSnapIds
  cancelWip()
  if (connectedIds.size > 0) tryGroupNew(shape.id, connectedIds)
  syncPropsPanel(shape)
  render()
}

function cancelWip() {
  wip = null; eDrag = null; rDrag = null; freehand = null
  wipLayer.innerHTML = ''
  wipSnapIds = new Set()
  wipFirstSnap = null
}

// ── Groups ─────────────────────────────────────────────────────────────────
function tryGroupNew(newId, connectedIds) {
  // Find all existing groups that contain any of the connected shape IDs
  const affected = groups.filter(g => [...connectedIds].some(id => g.memberIds.includes(id)))
  if (affected.length === 0) {
    // Nothing exists yet — create a new group
    groups.push({ id: nextGroupId++, memberIds: [newId, ...[...connectedIds]] })
  } else {
    // Merge all affected groups (and their members) into the first one
    const primary = affected[0]
    for (let i = 1; i < affected.length; i++) {
      for (const id of affected[i].memberIds)
        if (!primary.memberIds.includes(id)) primary.memberIds.push(id)
      groups = groups.filter(g => g.id !== affected[i].id)
    }
    for (const id of connectedIds)
      if (!primary.memberIds.includes(id)) primary.memberIds.push(id)
    if (!primary.memberIds.includes(newId)) primary.memberIds.push(newId)
  }
}

function getGroupOf(shapeId) {
  return groups.find(g => g.memberIds.includes(shapeId)) || null
}

function ungroupSelected() {
  if (selected === null) return
  const g = getGroupOf(selected)
  if (!g) return
  groups = groups.filter(grp => grp.id !== g.id)
  render()
}

// ── Undo / Redo ─────────────────────────────────────────────────────────────
function saveState() {
  undoStack.push(JSON.stringify({ shapes, groups, nextId, nextGroupId }))
  if (undoStack.length > 60) undoStack.shift()
  redoStack = []
}

function undo() {
  if (!undoStack.length) return
  redoStack.push(JSON.stringify({ shapes, groups, nextId, nextGroupId }))
  const st = JSON.parse(undoStack.pop())
  shapes = st.shapes; groups = st.groups; nextId = st.nextId; nextGroupId = st.nextGroupId
  selected = null; selectedNode = null; multiSelected.clear()
  render()
}

function redo() {
  if (!redoStack.length) return
  undoStack.push(JSON.stringify({ shapes, groups, nextId, nextGroupId }))
  const st = JSON.parse(redoStack.pop())
  shapes = st.shapes; groups = st.groups; nextId = st.nextId; nextGroupId = st.nextGroupId
  selected = null; selectedNode = null; multiSelected.clear()
  render()
}

// ── Save / Load / Export ────────────────────────────────────────────────────
function autoSave() {
  localStorage.setItem('jv_autosave', JSON.stringify({ shapes, groups, nextId, nextGroupId }))
}

function tryAutoLoad() {
  try {
    const raw = localStorage.getItem('jv_autosave')
    if (!raw) return
    const st = JSON.parse(raw)
    if (!Array.isArray(st.shapes)) return
    shapes = st.shapes; groups = st.groups || []
    nextId = st.nextId || (shapes.length ? Math.max(...shapes.map(s => s.id)) + 1 : 1)
    nextGroupId = st.nextGroupId || (groups.length ? Math.max(...groups.map(g => g.id)) + 1 : 1)
  } catch(e) { /* ignore corrupt state */ }
}

function downloadProject() {
  const data = JSON.stringify({ shapes, groups, nextId, nextGroupId }, null, 2)
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([data], { type: 'application/json' })),
    download: 'jormunvector.jv'
  })
  a.click(); URL.revokeObjectURL(a.href)
}

function loadProject(event) {
  const file = event.target.files[0]; if (!file) return
  const reader = new FileReader()
  reader.onload = e => {
    try {
      const st = JSON.parse(e.target.result)
      saveState()
      shapes = st.shapes || []; groups = st.groups || []
      nextId = st.nextId || 1; nextGroupId = st.nextGroupId || 1
      selected = null; selectedNode = null; multiSelected.clear()
      render()
    } catch(err) { alert('Could not load file: ' + err.message) }
  }
  reader.readAsText(file)
  event.target.value = ''
}

function downloadSVG() {
  const inner = document.getElementById('code-output').value
  const svgStr = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">\n${inner}\n</svg>`
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' })),
    download: 'jormunvector.svg'
  })
  a.click(); URL.revokeObjectURL(a.href)
}

// ── Zoom / Pan ──────────────────────────────────────────────────────────────
function applyViewTransform() {
  const { x, y, scale } = viewTransform
  canvasWrapper.style.transform = `translate(${x}px,${y}px) scale(${scale})`
  const pct = Math.round(scale * 100) + '%'
  const el = document.getElementById('view-info')
  if (el) el.textContent = pct
  const zp = document.getElementById('zoom-pct')
  if (zp) zp.textContent = pct
}
function zoomIn()  { viewTransform.scale = Math.min(4, viewTransform.scale * 1.25); applyViewTransform() }
function zoomOut() { viewTransform.scale = Math.max(0.5, viewTransform.scale / 1.25); applyViewTransform() }
function panBy(dx, dy) { viewTransform.x += dx; viewTransform.y += dy; applyViewTransform() }

function panKeyLoop() {
  const speed = 2.5
  let dx = 0, dy = 0
  if (panKeys.has('ArrowUp'))    dy += speed
  if (panKeys.has('ArrowDown'))  dy -= speed
  if (panKeys.has('ArrowLeft'))  dx += speed
  if (panKeys.has('ArrowRight')) dx -= speed
  if (dx !== 0 || dy !== 0) {
    viewTransform.x += dx
    viewTransform.y += dy
    applyViewTransform()
    panRafId = requestAnimationFrame(panKeyLoop)
  } else {
    panRafId = null
  }
}

function onWheel(e) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06
  const newScale = Math.max(0.5, Math.min(4, viewTransform.scale * factor))
  // Zoom toward the cursor
  const rect = canvasWrapper.getBoundingClientRect()
  const mx = e.clientX - (rect.left + rect.width  / 2)
  const my = e.clientY - (rect.top  + rect.height / 2)
  viewTransform.x += mx * (1 - newScale / viewTransform.scale)
  viewTransform.y += my * (1 - newScale / viewTransform.scale)
  viewTransform.scale = newScale
  applyViewTransform()
}

function onKeyUp(e) {
  if (e.key === ' ') {
    spaceDown = false
    if (isPanning) { isPanning = false; panStart = null; svgEl.classList.remove('grabbing') }
    svgEl.style.cursor = tool === 'select' ? '' : 'crosshair'
  }
  panKeys.delete(e.key)
}

// ── Hit testing ─────────────────────────────────────────────────────────────
function hitTestShape(shape, pt) {
  if (shape.hidden) return false
  const M = 7
  if (shape.type === 'ellipse') {
    const dx = (pt.x - shape.cx) / (shape.rx + M), dy = (pt.y - shape.cy) / (shape.ry + M)
    return dx * dx + dy * dy <= 1
  }
  if (shape.type === 'rect') {
    return pt.x >= shape.x - M && pt.x <= shape.x + shape.w + M &&
           pt.y >= shape.y - M && pt.y <= shape.y + shape.h + M
  }
  if (shape.type === 'path') {
    if (shape.nodes && shape.nodes.length) {
      const xs = shape.nodes.map(n => n.x), ys = shape.nodes.map(n => n.y)
      return pt.x >= Math.min(...xs) - M && pt.x <= Math.max(...xs) + M &&
             pt.y >= Math.min(...ys) - M && pt.y <= Math.max(...ys) + M
    }
  }
  return false
}

// ── Bounding box helpers ─────────────────────────────────────────────────────
function getShapeBounds(shape) {
  if (shape.type === 'ellipse') return { x: r(shape.cx - shape.rx), y: r(shape.cy - shape.ry), w: r(2*shape.rx), h: r(2*shape.ry) }
  if (shape.type === 'rect') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
  if (shape.nodes && shape.nodes.length) {
    const xs = shape.nodes.map(n => n.x), ys = shape.nodes.map(n => n.y)
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x: r(x), y: r(y), w: r(Math.max(...xs) - x), h: r(Math.max(...ys) - y) }
  }
  return null
}

function setShapeBounds(shape, newB, origB) {
  if (!origB || origB.w === 0 || origB.h === 0) return
  const scaleX = newB.w / origB.w
  const scaleY = newB.h / origB.h
  if (shape.type === 'ellipse') {
    shape.rx = r(Math.max(0.1, origB.w / 2 * scaleX))
    shape.ry = r(Math.max(0.1, origB.h / 2 * scaleY))
    shape.cx = r(newB.x + newB.w / 2)
    shape.cy = r(newB.y + newB.h / 2)
  } else if (shape.type === 'rect') {
    shape.x = r(newB.x); shape.y = r(newB.y)
    shape.w = r(Math.max(0.1, newB.w)); shape.h = r(Math.max(0.1, newB.h))
  } else if (shape.nodes) {
    shape.nodes = shape.nodes.map(n => ({
      ...n,
      x: r(newB.x + (n.x - origB.x) * scaleX),
      y: r(newB.y + (n.y - origB.y) * scaleY),
    }))
    if (shape.cps) {
      shape.cps = shape.cps.map(cp => {
        if (!cp) return null
        if (cp.cp1x !== undefined) return {
          cp1x: r(newB.x + (cp.cp1x - origB.x) * scaleX),
          cp1y: r(newB.y + (cp.cp1y - origB.y) * scaleY),
          cp2x: r(newB.x + (cp.cp2x - origB.x) * scaleX),
          cp2y: r(newB.y + (cp.cp2y - origB.y) * scaleY),
        }
        return {
          cx: r(newB.x + (cp.cx - origB.x) * scaleX),
          cy: r(newB.y + (cp.cy - origB.y) * scaleY),
        }
      })
    }
  }
}

// Returns positions of 8 resize handles for a bounding box
// 0=TL,1=TC,2=TR,3=RC,4=BR,5=BC,6=BL,7=LC
function resizeHandlePositions(b) {
  return [
    { x: b.x,             y: b.y             },
    { x: b.x + b.w / 2,  y: b.y             },
    { x: b.x + b.w,      y: b.y             },
    { x: b.x + b.w,      y: b.y + b.h / 2  },
    { x: b.x + b.w,      y: b.y + b.h       },
    { x: b.x + b.w / 2,  y: b.y + b.h       },
    { x: b.x,             y: b.y + b.h       },
    { x: b.x,             y: b.y + b.h / 2  },
  ]
}

// ── Shape drag (move on canvas) ─────────────────────────────────────────────
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)) }

function applyShapeDrag(pt) {
  if (!shapeDrag) return
  const dx = r(pt.x - shapeDrag.startPt.x), dy = r(pt.y - shapeDrag.startPt.y)
  for (const [id, orig] of shapeDrag.origMap) {
    const shape = shapes.find(s => s.id === id)
    if (!shape) continue
    if (orig.nodes) {
      shape.nodes = orig.nodes.map(n => ({ ...n, x: r(n.x + dx), y: r(n.y + dy) }))
      if (orig.cps) shape.cps = orig.cps.map(cp => {
        if (!cp) return null
        if (cp.cp1x !== undefined)
          return { cp1x: r(cp.cp1x+dx), cp1y: r(cp.cp1y+dy), cp2x: r(cp.cp2x+dx), cp2y: r(cp.cp2y+dy) }
        return { cx: r(cp.cx+dx), cy: r(cp.cy+dy) }
      })
    } else if (shape.type === 'ellipse') {
      shape.cx = r(orig.cx + dx); shape.cy = r(orig.cy + dy)
    } else if (shape.type === 'rect') {
      shape.x = r(orig.x + dx); shape.y = r(orig.y + dy)
    }
  }
  render()
}

// ── Resize drag ─────────────────────────────────────────────────────────────
function applyResizeDrag(pt) {
  if (!resizeDrag) return
  const { handleIdx, origBounds: ob, origShapeData, shapeId } = resizeDrag
  const shape = shapes.find(s => s.id === shapeId)
  if (!shape) return

  let { x, y, w, h } = ob
  const right  = ob.x + ob.w
  const bottom = ob.y + ob.h

  // Determine which edges move based on handle index
  // 0=TL,1=TC,2=TR,3=RC,4=BR,5=BC,6=BL,7=LC
  const movesLeft   = (handleIdx === 0 || handleIdx === 6 || handleIdx === 7)
  const movesRight  = (handleIdx === 2 || handleIdx === 3 || handleIdx === 4)
  const movesTop    = (handleIdx === 0 || handleIdx === 1 || handleIdx === 2)
  const movesBottom = (handleIdx === 4 || handleIdx === 5 || handleIdx === 6)

  if (movesLeft)   { x = Math.min(pt.x, right - 0.1);  w = right - x }
  if (movesRight)  { w = Math.max(0.1, pt.x - ob.x);   x = ob.x }
  if (movesTop)    { y = Math.min(pt.y, bottom - 0.1); h = bottom - y }
  if (movesBottom) { h = Math.max(0.1, pt.y - ob.y);   y = ob.y }

  const newB = { x: r(x), y: r(y), w: r(w), h: r(h) }
  // Restore original data before applying new bounds
  Object.assign(shape, deepClone(origShapeData))
  setShapeBounds(shape, newB, ob)
  render()
}

// ── Duplicate ───────────────────────────────────────────────────────────────
function duplicateSelected() {
  if (selected === null) return
  const shape = shapes.find(s => s.id === selected)
  if (!shape) return
  saveState()
  const clone = deepClone(shape)
  clone.id = nextId++
  if (clone.nodes) clone.nodes = clone.nodes.map(n => ({ ...n, x: r(n.x + 5), y: r(n.y + 5) }))
  if (clone.cps)   clone.cps   = clone.cps.map(cp => {
    if (!cp) return null
    if (cp.cp1x !== undefined)
      return { cp1x: r(cp.cp1x+5), cp1y: r(cp.cp1y+5), cp2x: r(cp.cp2x+5), cp2y: r(cp.cp2y+5) }
    return { cx: r(cp.cx+5), cy: r(cp.cy+5) }
  })
  if (clone.type === 'ellipse') { clone.cx = r(clone.cx+5); clone.cy = r(clone.cy+5) }
  if (clone.type === 'rect')    { clone.x  = r(clone.x+5);  clone.y  = r(clone.y+5)  }
  shapes.push(clone)
  selected = clone.id
  render()
}

// ── Delete selected node ─────────────────────────────────────────────────────
function deleteSelectedNode() {
  if (!selectedNode) return
  const shape = shapes.find(s => s.id === selectedNode.shapeId)
  if (!shape || !shape.nodes || shape.nodes.length <= 2) return
  saveState()
  const idx = selectedNode.nodeIdx
  shape.nodes.splice(idx, 1)
  shape.segs.splice(idx, 1)
  shape.cps.splice(idx, 1)
  shape.segs[0] = null; shape.cps[0] = null
  selectedNode = null
  render()
}

// ── Insert node on segment (double-click on path) ────────────────────────────
function findSegmentAt(shape, pt) {
  if (!shape.nodes) return -1
  const { nodes, segs, cps } = shape
  for (let i = 1; i < nodes.length; i++) {
    const p0 = nodes[i-1], p1 = nodes[i], cp = cps[i]
    let minD = Infinity
    for (let k = 0; k <= 20; k++) {
      const t = k / 20
      let sx, sy
      if (segs[i] === 'C' && cp) {
        sx = cubicB(p0.x, cp.cp1x, cp.cp2x, p1.x, t)
        sy = cubicB(p0.y, cp.cp1y, cp.cp2y, p1.y, t)
      } else if (segs[i] === 'Q' && cp) {
        sx = quadB(p0.x, cp.cx, p1.x, t); sy = quadB(p0.y, cp.cy, p1.y, t)
      } else {
        sx = p0.x + t * (p1.x - p0.x); sy = p0.y + t * (p1.y - p0.y)
      }
      const d = Math.sqrt((sx-pt.x)**2 + (sy-pt.y)**2)
      if (d < minD) minD = d
    }
    if (minD < 7) return i
  }
  return -1
}

function insertNodeOnSegment(shape, segIdx) {
  const { nodes, segs, cps } = shape
  const p0 = nodes[segIdx-1], p1 = nodes[segIdx]
  const cp = cps[segIdx], segType = segs[segIdx]
  let midX, midY, cpFirst
  if (segType === 'C' && cp) {
    // De Casteljau split at t = 0.5
    const ax = (p0.x+cp.cp1x)/2,  ay = (p0.y+cp.cp1y)/2
    const bx = (cp.cp1x+cp.cp2x)/2, by = (cp.cp1y+cp.cp2y)/2
    const cx2= (cp.cp2x+p1.x)/2,  cy2= (cp.cp2y+p1.y)/2
    const dx2= (ax+bx)/2,  dy2= (ay+by)/2
    const ex = (bx+cx2)/2, ey = (by+cy2)/2
    midX = r((dx2+ex)/2); midY = r((dy2+ey)/2)
    cpFirst = { cp1x: r(ax), cp1y: r(ay), cp2x: r(dx2), cp2y: r(dy2) }
    // Trim original segment to second half (arriving at p1 from new mid)
    cps[segIdx] = { cp1x: r(ex), cp1y: r(ey), cp2x: r(cx2), cp2y: r(cy2) }
  } else {
    midX = r((p0.x+p1.x)/2); midY = r((p0.y+p1.y)/2)
    cpFirst = null
  }
  nodes.splice(segIdx, 0, { x: midX, y: midY, locked: false })
  segs.splice(segIdx, 0, segType === 'C' ? 'C' : 'L')
  cps.splice(segIdx, 0, cpFirst)
}

// ── Layer reorder ────────────────────────────────────────────────────────────
function moveShapeLayer(id, dir) {
  const idx = shapes.findIndex(s => s.id === id)
  if (idx === -1) return
  const newIdx = idx + dir
  if (newIdx < 0 || newIdx >= shapes.length) return
  saveState()
  ;[shapes[idx], shapes[newIdx]] = [shapes[newIdx], shapes[idx]]
  render()
}

// ── Close / open path toggle ─────────────────────────────────────────────────
function togglePathClosed() {
  if (selected === null) return
  const shape = shapes.find(s => s.id === selected)
  if (!shape || shape.type !== 'path' || !shape.nodes) return
  saveState()
  shape.closed = !shape.closed
  render()
}

// ── Snap to grid toggle ──────────────────────────────────────────────────────
function toggleSnapGrid() {
  snapToGridEnabled = !snapToGridEnabled
  document.getElementById('btn-grid').classList.toggle('active', snapToGridEnabled)
}

// ── Hex color inputs ─────────────────────────────────────────────────────────
function syncColorFromHex(which) {
  const hex = document.getElementById(`prop-${which}-hex`).value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    document.getElementById(`prop-${which}`).value = hex
    updateProps()
  }
}
function syncStrokeFromColor() {
  document.getElementById('prop-stroke-hex').value = document.getElementById('prop-stroke').value
  updateProps()
}
function syncFillFromColor() {
  document.getElementById('prop-fill-hex').value = document.getElementById('prop-fill').value
  updateProps()
}

// ── Marquee (rubber-band) selection ────────────────────────────────────────
function renderMarquee(x0, y0, x1, y1) {
  const mx = Math.min(x0, x1), my = Math.min(y0, y1)
  const mw = Math.abs(x1 - x0), mh = Math.abs(y1 - y0)
  let html = ''
  // Live bounding-box highlight for each shape that would be captured
  const hits = shapes.filter(s => !s.hidden && !s.locked && shapeBoundsIntersects(s, mx, my, mx + mw, my + mh))
  for (const s of hits) {
    const b = getShapeBounds(s)
    if (b) html += `<rect x="${b.x - 1}" y="${b.y - 1}" width="${b.w + 2}" height="${b.h + 2}"
      fill="#4ade8018" stroke="#4ade8077" stroke-width="0.4" rx="1"/>`
  }
  // The marquee rectangle itself
  html += `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}"
    fill="#4ade800d" stroke="#4ade80" stroke-width="0.6" stroke-dasharray="3 2"/>`
  wipLayer.innerHTML = html
}

function shapeBoundsIntersects(shape, rx0, ry0, rx1, ry1) {
  const b = getShapeBounds(shape)
  if (!b) return false
  return !(b.x + b.w < rx0 || b.x > rx1 || b.y + b.h < ry0 || b.y > ry1)
}

// ── Freehand ───────────────────────────────────────────────────────────────
function renderFreehand() {
  if (!freehand || freehand.rawPts.length < 2) return
  const d = linePathD(freehand.rawPts, false)
  wipLayer.innerHTML = `<path d="${d}" fill="none" stroke="#4ade80" stroke-width="0.8"
    opacity="0.6" stroke-linecap="round" stroke-linejoin="round"/>`
}

function commitFreehand() {
  if (!freehand || freehand.rawPts.length < 2) { freehand = null; wipLayer.innerHTML = ''; return }

  // Ramer-Douglas-Peucker simplification
  const simplified = rdpSimplify(freehand.rawPts, 2.0)
  freehand = null
  wipLayer.innerHTML = ''

  if (simplified.length < 2) return

  // Build rich path model with Catmull-Rom bezier for smooth organic result
  const nodes = simplified.map(p => ({ x: p.x, y: p.y, locked: false }))
  const segs  = [null]
  const cps   = [null]
  const t     = 0.4
  const n     = nodes.length

  for (let i = 1; i < n; i++) {
    const p0 = nodes[Math.max(0, i - 2)]
    const p1 = nodes[i - 1]
    const p2 = nodes[i]
    const p3 = nodes[Math.min(n - 1, i + 1)]
    segs.push('C')
    cps.push({
      cp1x: r(p1.x + (p2.x - p0.x) * t / 3),
      cp1y: r(p1.y + (p2.y - p0.y) * t / 3),
      cp2x: r(p2.x - (p3.x - p1.x) * t / 3),
      cp2y: r(p2.y - (p3.y - p1.y) * t / 3),
    })
  }

  commitShape({ type: 'path', nodes, segs, cps, closed: false, ...getProps() })
}

// Ramer-Douglas-Peucker polyline simplification


// ── Node editing ───────────────────────────────────────────────────────────
// Returns array of { kind: 'node'|'cp1'|'cp2'|'mid', idx, x, y }
// cp1 = handle leaving nodes[idx-1], cp2 = handle arriving at nodes[idx]
function editHandles(shape) {
  if (shape.type !== 'path') return []
  if (!shape.nodes) return []   // raw d string — not editable via handles
  const handles = []
  const { nodes, segs, cps } = shape

  // Anchor nodes first (checked first so they win over overlapping CPs)
  nodes.forEach((n, i) => handles.push({ kind: 'node', idx: i, x: n.x, y: n.y }))

  // Per-segment handles
  for (let i = 1; i < nodes.length; i++) {
    const p0 = nodes[i - 1], p1 = nodes[i]
    if (segs[i] === 'C' && cps[i]) {
      handles.push({ kind: 'cp1', idx: i, x: cps[i].cp1x, y: cps[i].cp1y })
      handles.push({ kind: 'cp2', idx: i, x: cps[i].cp2x, y: cps[i].cp2y })
    } else if (segs[i] === 'L') {
      handles.push({ kind: 'mid', idx: i, x: r((p0.x + p1.x) / 2), y: r((p0.y + p1.y) / 2) })
    } else if (segs[i] === 'Q' && cps[i]) {
      handles.push({
        kind: 'mid', idx: i,
        x: r(0.25 * p0.x + 0.5 * cps[i].cx + 0.25 * p1.x),
        y: r(0.25 * p0.y + 0.5 * cps[i].cy + 0.25 * p1.y),
      })
    }
  }

  return handles
}

function applyNodeDrag(pt) {
  const shape = shapes.find(s => s.id === nodeDrag.shapeId)
  if (!shape) return

  const { kind, idx } = nodeDrag
  const { nodes, segs, cps } = shape

  if (kind === 'node') {
    // Move the anchor; shift adjacent control points by the same delta
    const dx = r(pt.x - nodes[idx].x)
    const dy = r(pt.y - nodes[idx].y)
    nodes[idx] = { ...nodes[idx], x: pt.x, y: pt.y }
    // incoming segment cp2
    if (segs[idx] === 'C' && cps[idx])
      cps[idx] = { ...cps[idx], cp2x: r(cps[idx].cp2x + dx), cp2y: r(cps[idx].cp2y + dy) }
    if (segs[idx] === 'Q' && cps[idx])
      cps[idx] = { ...cps[idx], cx: r(cps[idx].cx + dx), cy: r(cps[idx].cy + dy) }
    // outgoing segment cp1
    if (idx + 1 < segs.length && segs[idx + 1] === 'C' && cps[idx + 1])
      cps[idx + 1] = { ...cps[idx + 1], cp1x: r(cps[idx + 1].cp1x + dx), cp1y: r(cps[idx + 1].cp1y + dy) }
    if (idx + 1 < segs.length && segs[idx + 1] === 'Q' && cps[idx + 1])
      cps[idx + 1] = { ...cps[idx + 1], cx: r(cps[idx + 1].cx + dx), cy: r(cps[idx + 1].cy + dy) }

  } else if (kind === 'cp1') {
    // cp1 leaves nodes[idx-1] toward nodes[idx]
    cps[idx] = { ...cps[idx], cp1x: pt.x, cp1y: pt.y }
    // Smooth node: mirror through nodes[idx-1] into cp2 of the incoming segment
    const anchor = nodes[idx - 1]
    if (!anchor.locked && idx - 1 > 0 && segs[idx - 1] === 'C' && cps[idx - 1]) {
      cps[idx - 1] = { ...cps[idx - 1], cp2x: r(2 * anchor.x - pt.x), cp2y: r(2 * anchor.y - pt.y) }
    }

  } else if (kind === 'cp2') {
    // cp2 arrives at nodes[idx] from nodes[idx-1]
    cps[idx] = { ...cps[idx], cp2x: pt.x, cp2y: pt.y }
    // Smooth node: mirror through nodes[idx] into cp1 of the outgoing segment
    const anchor = nodes[idx]
    if (!anchor.locked && idx + 1 < segs.length && segs[idx + 1] === 'C' && cps[idx + 1]) {
      cps[idx + 1] = { ...cps[idx + 1], cp1x: r(2 * anchor.x - pt.x), cp1y: r(2 * anchor.y - pt.y) }
    }

  } else if (kind === 'mid') {
    // Drag L midpoint → bend to Q; update existing Q
    const p0 = nodes[idx - 1], p1 = nodes[idx]
    shape.segs[idx] = 'Q'
    shape.cps[idx]  = {
      cx: r(2 * pt.x - 0.5 * p0.x - 0.5 * p1.x),
      cy: r(2 * pt.y - 0.5 * p0.y - 0.5 * p1.y),
    }
  }

  render()
}

function renderEditOverlay() {
  if (tool !== 'select') { editLayer.innerHTML = ''; return }

  let html = ''

  const isMulti = multiSelected.size > 0

  // ── Multi-select: bounding box for EVERY selected shape, no handles ──
  if (isMulti) {
    const allSelIds = new Set(multiSelected)
    if (selected !== null) allSelIds.add(selected)
    for (const id of allSelIds) {
      const s = shapes.find(sh => sh.id === id)
      if (!s || s.hidden) continue
      const b = getShapeBounds(s)
      if (!b) continue
      const rotAttr = (s.rotation)
        ? ` transform="rotate(${s.rotation},${r(b.x+b.w/2)},${r(b.y+b.h/2)})"` : ''
      html += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"
               fill="none" stroke="#4ade8077" stroke-width="0.6" stroke-dasharray="2 2"
               pointer-events="none"${rotAttr}/>`
    }
    editLayer.innerHTML = html
    return
  }

  // ── Single selection: bounding box + resize handles + path editing ──
  const shape = shapes.find(s => s.id === selected)
  if (shape && !shape.hidden) {
    const b = getShapeBounds(shape)
    const rotAttr = (shape.rotation && b)
      ? ` transform="rotate(${shape.rotation},${r(b.x+b.w/2)},${r(b.y+b.h/2)})"` : ''
    if (b) {
      const rh = resizeHandlePositions(b)
      html += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"
               fill="none" stroke="#4ade8033" stroke-width="0.5" stroke-dasharray="2 2"
               pointer-events="none"${rotAttr}/>`
      const cursors = ['nwse-resize','ns-resize','nesw-resize','ew-resize','nwse-resize','ns-resize','nesw-resize','ew-resize']
      rh.forEach((h, i) => {
        html += `<rect x="${h.x - 3.5}" y="${h.y - 3.5}" width="7" height="7" rx="1"
                 fill="#18181b" stroke="#4ade80" stroke-width="0.8" style="cursor:${cursors[i]}"/>`
      })
    }

    // ── Path-specific editing: arm lines, CP handles, anchor nodes ──
    if (shape.type === 'path' && shape.nodes) {
      const { nodes, segs, cps } = shape

      // Arm lines from anchor to its control points
      for (let i = 1; i < nodes.length; i++) {
        if (segs[i] === 'C' && cps[i]) {
          const p0 = nodes[i - 1], p1 = nodes[i]
          html += `<line x1="${p0.x}" y1="${p0.y}" x2="${cps[i].cp1x}" y2="${cps[i].cp1y}"
                   stroke="#3f3f46" stroke-width="0.6"/>`
          html += `<line x1="${p1.x}" y1="${p1.y}" x2="${cps[i].cp2x}" y2="${cps[i].cp2y}"
                   stroke="#3f3f46" stroke-width="0.6"/>`
        }
      }

      // CP handles (drawn below anchor nodes)
      for (let i = 1; i < nodes.length; i++) {
        if (segs[i] === 'C' && cps[i]) {
          html += `<circle cx="${cps[i].cp1x}" cy="${cps[i].cp1y}" r="2.2"
                   fill="#27272a" stroke="#71717a" stroke-width="0.8" style="cursor:grab"/>`
          html += `<circle cx="${cps[i].cp2x}" cy="${cps[i].cp2y}" r="2.2"
                   fill="#27272a" stroke="#71717a" stroke-width="0.8" style="cursor:grab"/>`
        } else if (segs[i] === 'L') {
          const s = 2.5, mx = r((nodes[i-1].x + nodes[i].x) / 2), my = r((nodes[i-1].y + nodes[i].y) / 2)
          html += `<polygon points="${mx},${my-s} ${mx+s},${my} ${mx},${my+s} ${mx-s},${my}"
                   fill="#27272a" stroke="#71717a" stroke-width="0.8" style="cursor:grab"/>`
        } else if (segs[i] === 'Q' && cps[i]) {
          const p0 = nodes[i-1], p1 = nodes[i], cp = cps[i]
          const mx = r(0.25*p0.x + 0.5*cp.cx + 0.25*p1.x), my = r(0.25*p0.y + 0.5*cp.cy + 0.25*p1.y)
          const s = 2.5
          html += `<polygon points="${mx},${my-s} ${mx+s},${my} ${mx},${my+s} ${mx-s},${my}"
                   fill="#27272a" stroke="#71717a" stroke-width="0.8" style="cursor:grab"/>`
        }
      }

      // Anchor nodes (on top)
      nodes.forEach((n, i) => {
        const locked  = n.locked || false
        const focused = selectedNode && selectedNode.shapeId === selected && selectedNode.nodeIdx === i
        const color   = locked ? '#fbbf24' : '#4ade80'
        html += `<circle cx="${n.x}" cy="${n.y}" r="3"
                 fill="${locked ? '#451a03' : '#09090b'}" stroke="${color}" stroke-width="1"
                 style="cursor:grab"/>`

        if (focused) {
          const bx = n.x + 5, by = n.y - 10
          const btnColor = locked ? '#fbbf24' : '#52525b'
          html += `<g onclick="toggleNodeLock(${i})" style="cursor:pointer">
            <rect x="${bx}" y="${by}" width="18" height="8" rx="1.5"
                  fill="#18181b" stroke="${btnColor}" stroke-width="0.7"/>
            <text x="${bx + 9}" y="${by + 5.5}" text-anchor="middle" font-size="4.5"
                  font-family="monospace" fill="${btnColor}" style="pointer-events:none">
              ${locked ? 'LOCK' : 'FREE'}
            </text>
          </g>`
        }
      })
    }
  }

  editLayer.innerHTML = html
}

function toggleNodeLock(nodeIdx) {
  const shape = shapes.find(s => s.id === selected)
  if (!shape || shape.type !== 'path') return
  const n = shape.nodes[nodeIdx]
  shape.nodes[nodeIdx] = { ...n, locked: !n.locked }
  render()
}

// ── Visibility / Lock per shape ─────────────────────────────────────────────
function toggleShapeVisible(id) {
  const shape = shapes.find(s => s.id === id)
  if (!shape) return
  saveState()
  shape.hidden = !shape.hidden
  render()
}

function toggleShapeLocked(id) {
  const shape = shapes.find(s => s.id === id)
  if (!shape) return
  saveState()
  shape.locked = !shape.locked
  render()
}

// ── Transform panel ──────────────────────────────────────────────────────────
function syncTransformPanel(shape) {
  if (!shape) return
  const b = getShapeBounds(shape)
  const tfPanel = document.getElementById('transform-panel')
  if (!b) { if (tfPanel) tfPanel.style.display = 'none'; return }
  const xEl = document.getElementById('tf-x')
  const yEl = document.getElementById('tf-y')
  const wEl = document.getElementById('tf-w')
  const hEl = document.getElementById('tf-h')
  const rEl = document.getElementById('tf-rot')
  if (xEl) xEl.value = r(b.x)
  if (yEl) yEl.value = r(b.y)
  if (wEl) wEl.value = r(b.w)
  if (hEl) hEl.value = r(b.h)
  if (rEl) rEl.value = shape.rotation || 0
}

function applyTransformPanel() {
  if (selected === null) return
  const shape = shapes.find(s => s.id === selected)
  if (!shape) return
  const origB = getShapeBounds(shape)
  if (!origB) return
  const xv = parseFloat(document.getElementById('tf-x').value)
  const yv = parseFloat(document.getElementById('tf-y').value)
  const wv = parseFloat(document.getElementById('tf-w').value)
  const hv = parseFloat(document.getElementById('tf-h').value)
  const rv = parseFloat(document.getElementById('tf-rot').value)
  if (isNaN(xv) || isNaN(yv) || isNaN(wv) || isNaN(hv)) return
  const newB = { x: xv, y: yv, w: Math.max(0.1, wv), h: Math.max(0.1, hv) }
  setShapeBounds(shape, newB, origB)
  shape.rotation = isNaN(rv) ? 0 : rv
  render()
}

// ── Align & Distribute ───────────────────────────────────────────────────────
function getSelectedShapes() {
  const allSelIds = [...multiSelected]
  if (selected !== null && !multiSelected.has(selected)) allSelIds.push(selected)
  return allSelIds.map(id => shapes.find(s => s.id === id)).filter(Boolean)
}

function alignShapes(mode) {
  const sel = getSelectedShapes()
  if (sel.length < 2) return
  saveState()
  const bounds = sel.map(s => getShapeBounds(s))
  const validPairs = sel.map((s, i) => ({ s, b: bounds[i] })).filter(p => p.b)
  if (!validPairs.length) return

  const minX = Math.min(...validPairs.map(p => p.b.x))
  const maxX = Math.max(...validPairs.map(p => p.b.x + p.b.w))
  const minY = Math.min(...validPairs.map(p => p.b.y))
  const maxY = Math.max(...validPairs.map(p => p.b.y + p.b.h))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  for (const { s, b } of validPairs) {
    let newB = { ...b }
    if (mode === 'left')    newB.x = minX
    if (mode === 'centerH') newB.x = r(centerX - b.w / 2)
    if (mode === 'right')   newB.x = r(maxX - b.w)
    if (mode === 'top')     newB.y = minY
    if (mode === 'centerV') newB.y = r(centerY - b.h / 2)
    if (mode === 'bottom')  newB.y = r(maxY - b.h)
    setShapeBounds(s, newB, b)
  }
  render()
}

function distributeShapes(dir) {
  const sel = getSelectedShapes()
  if (sel.length < 3) return
  saveState()
  const pairs = sel.map(s => ({ s, b: getShapeBounds(s) })).filter(p => p.b)
  if (pairs.length < 3) return

  if (dir === 'h') {
    pairs.sort((a, b) => a.b.x - b.b.x)
    const totalW = pairs.reduce((acc, p) => acc + p.b.w, 0)
    const span = pairs[pairs.length-1].b.x + pairs[pairs.length-1].b.w - pairs[0].b.x
    const gap = (span - totalW) / (pairs.length - 1)
    let cx = pairs[0].b.x
    for (const { s, b } of pairs) {
      setShapeBounds(s, { ...b, x: r(cx) }, b)
      cx += b.w + gap
    }
  } else {
    pairs.sort((a, b) => a.b.y - b.b.y)
    const totalH = pairs.reduce((acc, p) => acc + p.b.h, 0)
    const span = pairs[pairs.length-1].b.y + pairs[pairs.length-1].b.h - pairs[0].b.y
    const gap = (span - totalH) / (pairs.length - 1)
    let cy = pairs[0].b.y
    for (const { s, b } of pairs) {
      setShapeBounds(s, { ...b, y: r(cy) }, b)
      cy += b.h + gap
    }
  }
  render()
}

// ── Boolean operations ───────────────────────────────────────────────────────
function reversePathD(d) {
  // Naive reversal: just return d as-is (compound path order still makes clip)
  return d
}

function booleanOp(op) {
  const sel = getSelectedShapes()
  if (sel.length !== 2) return
  const [s1, s2] = sel
  if (s1.type !== 'path' || s2.type !== 'path') return
  const d1 = pathD(s1)
  const d2 = pathD(s2)
  if (!d1 || !d2) return
  saveState()

  let compound = ''
  if (op === 'union') {
    compound = d1 + ' ' + d2
  } else if (op === 'subtract') {
    // Reverse d2 to create a hole
    compound = d1 + ' ' + reversePathD(d2)
  } else if (op === 'intersect') {
    compound = d1 + ' ' + reversePathD(d2)
  }

  const newShape = {
    type: 'path',
    d: compound,
    stroke: s1.stroke,
    fill: s1.fill !== 'none' ? s1.fill : (s2.fill !== 'none' ? s2.fill : '#4ade80'),
    'stroke-width': s1['stroke-width'],
    opacity: s1.opacity ?? 1,
    'fill-rule': 'evenodd',
    strokeDash: s1.strokeDash || '',
  }

  // Remove originals
  const ids = new Set([s1.id, s2.id])
  shapes = shapes.filter(s => !ids.has(s.id))
  multiSelected.clear()
  selected = null
  newShape.id = nextId++
  shapes.push(newShape)
  selected = newShape.id
  syncPropsPanel(newShape)
  render()
}

// ── Copy / Paste ─────────────────────────────────────────────────────────────
function copySelected() {
  const allSelIds = [...multiSelected]
  if (selected !== null && !multiSelected.has(selected)) allSelIds.push(selected)
  if (!allSelIds.length) return
  clipboard = allSelIds.map(id => shapes.find(s => s.id === id)).filter(Boolean).map(deepClone)
}

function pasteClipboard() {
  if (!clipboard.length) return
  saveState()
  multiSelected.clear()
  const newShapes = []
  for (const orig of clipboard) {
    const clone = deepClone(orig)
    clone.id = nextId++
    // Offset by 5
    if (clone.nodes) {
      clone.nodes = clone.nodes.map(n => ({ ...n, x: r(n.x + 5), y: r(n.y + 5) }))
      if (clone.cps) clone.cps = clone.cps.map(cp => {
        if (!cp) return null
        if (cp.cp1x !== undefined)
          return { cp1x: r(cp.cp1x+5), cp1y: r(cp.cp1y+5), cp2x: r(cp.cp2x+5), cp2y: r(cp.cp2y+5) }
        return { cx: r(cp.cx+5), cy: r(cp.cy+5) }
      })
    }
    if (clone.type === 'ellipse') { clone.cx = r(clone.cx+5); clone.cy = r(clone.cy+5) }
    if (clone.type === 'rect')    { clone.x  = r(clone.x+5);  clone.y  = r(clone.y+5)  }
    shapes.push(clone)
    newShapes.push(clone)
  }
  if (newShapes.length === 1) {
    selected = newShapes[0].id
  } else {
    selected = newShapes[newShapes.length - 1].id
    for (const s of newShapes) multiSelected.add(s.id)
  }
  render()
}

// ── Import SVG ───────────────────────────────────────────────────────────────
function importSVGFile(event) {
  const file = event.target.files[0]; if (!file) return
  const reader = new FileReader()
  reader.onload = e => {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(e.target.result, 'image/svg+xml')
      const elems = doc.querySelectorAll('path, ellipse, circle, rect')
      if (!elems.length) { alert('No importable shapes found in SVG.'); return }
      saveState()
      let added = 0
      const props = getProps()
      for (const el of elems) {
        const tag = el.tagName.toLowerCase()
        const getN = attr => parseFloat(el.getAttribute(attr)) || 0
        const style = el.getAttribute('style') || ''
        const parseStyleColor = (prop, fallback) => {
          const m = style.match(new RegExp(prop + '\\s*:\\s*([^;]+)'))
          return m ? m[1].trim() : (el.getAttribute(prop) || fallback)
        }
        const stroke = parseStyleColor('stroke', props.stroke)
        const fill   = parseStyleColor('fill', props.fill)
        const sw     = parseFloat(parseStyleColor('stroke-width', props['stroke-width'])) || props['stroke-width']
        const opacity = parseFloat(parseStyleColor('opacity', 1)) || 1

        let shape = null
        if (tag === 'circle') {
          shape = { type:'ellipse', cx:getN('cx'), cy:getN('cy'), rx:getN('r'), ry:getN('r'), stroke, fill, 'stroke-width':sw, opacity }
        } else if (tag === 'ellipse') {
          shape = { type:'ellipse', cx:getN('cx'), cy:getN('cy'), rx:getN('rx'), ry:getN('ry'), stroke, fill, 'stroke-width':sw, opacity }
        } else if (tag === 'rect') {
          shape = { type:'rect', x:getN('x'), y:getN('y'), w:getN('width'), h:getN('height'), stroke, fill, 'stroke-width':sw, opacity }
        } else if (tag === 'path') {
          const d = el.getAttribute('d')
          if (d) shape = { type:'path', d, stroke, fill, 'stroke-width':sw, opacity }
        }
        if (shape) { shape.id = nextId++; shapes.push(shape); selected = shape.id; added++ }
      }
      if (added) { syncPropsPanel(shapes.find(s => s.id === selected)); render() }
      else alert('No valid shapes could be imported.')
    } catch(err) { alert('Import failed: ' + err.message) }
  }
  reader.readAsText(file)
  event.target.value = ''
}

// ── Properties ─────────────────────────────────────────────────────────────
function getProps() {
  return {
    stroke:         document.getElementById('prop-stroke-none').checked ? 'none' : document.getElementById('prop-stroke').value,
    fill:           document.getElementById('prop-fill-none').checked   ? 'none' : document.getElementById('prop-fill').value,
    'stroke-width': parseFloat(document.getElementById('prop-sw').value) || 1.5,
    opacity:        parseInt(document.getElementById('prop-opacity').value) / 100,
    strokeDash:     document.getElementById('prop-dash').value || '',
  }
}

function updateProps() {
  document.getElementById('opacity-val').textContent =
    document.getElementById('prop-opacity').value + '%'
  if (selected !== null) {
    const shape = shapes.find(s => s.id === selected)
    if (shape) { Object.assign(shape, getProps()); render() }
  }
}

function syncPropsPanel(shape) {
  if (!shape) return
  document.getElementById('prop-stroke-none').checked = shape.stroke === 'none'
  const strokeVal = shape.stroke !== 'none' ? (shape.stroke || '#4ade80') : '#4ade80'
  document.getElementById('prop-stroke').value = strokeVal
  document.getElementById('prop-stroke-hex').value = strokeVal
  document.getElementById('prop-fill-none').checked = shape.fill === 'none'
  const fillVal = shape.fill !== 'none' ? (shape.fill || '#4ade80') : '#4ade80'
  document.getElementById('prop-fill').value = fillVal
  document.getElementById('prop-fill-hex').value = fillVal
  document.getElementById('prop-sw').value = shape['stroke-width'] ?? 1.5
  const op = Math.round((shape.opacity ?? 1) * 100)
  document.getElementById('prop-opacity').value = op
  document.getElementById('opacity-val').textContent = op + '%'
  document.getElementById('prop-dash').value = shape.strokeDash || ''
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  shapesLayer.innerHTML = shapes.map(shapeToSvg).join('\n')

  const list = document.getElementById('shapes-list')
  list.innerHTML = shapes.length
    ? shapes.map(s => {
        const g = getGroupOf(s.id)
        const inSel = s.id === selected || (g && g.memberIds.includes(selected))
        const inMulti = multiSelected.has(s.id)
        const gTag = g ? ` <span style="color:#4ade8055;font-size:9px" title="grouped">⛓</span>` : ''
        return `<div class="shape-item ${inSel ? 'selected' : ''} ${inMulti ? 'multi-sel' : ''}" onclick="selectShape(${s.id},event)">
          <span class="shape-name" style="${s.hidden ? 'opacity:0.35' : ''}">${shapeName(s)}${gTag}</span>
          <span style="display:flex;gap:2px;align-items:center;flex-shrink:0">
            <button class="vis-btn ${s.hidden ? 'hidden-shape' : ''}" title="${s.hidden ? 'show' : 'hide'}" onclick="event.stopPropagation();toggleShapeVisible(${s.id})">${s.hidden ? '&#x1F441;&#xFE0E;' : '&#x1F441;'}</button>
            <button class="lock-btn ${s.locked ? 'locked-shape' : ''}" title="${s.locked ? 'unlock' : 'lock'}" onclick="event.stopPropagation();toggleShapeLocked(${s.id})">&#x1F512;</button>
            <button class="layer-btn" title="bring forward" onclick="event.stopPropagation();moveShapeLayer(${s.id},1)">&#x25B2;</button>
            <button class="layer-btn" title="send backward" onclick="event.stopPropagation();moveShapeLayer(${s.id},-1)">&#x25BC;</button>
            <span class="del-btn" title="delete" onclick="event.stopPropagation();deleteShape(${s.id})">&#xD7;</span>
          </span>
        </div>`
      }).join('')
    : '<div class="empty-hint">no shapes yet</div>'

  renderEditOverlay()
  updateCode()

  // Show expand panel only when a path-with-nodes is selected
  const _selShape = shapes.find(s => s.id === selected)
  document.getElementById('expand-panel').style.display =
    (_selShape && _selShape.type === 'path' && _selShape.nodes) ? '' : 'none'

  // Show group panel when selected shape belongs to a group
  const selGroup = selected !== null ? getGroupOf(selected) : null
  document.getElementById('group-panel').style.display = selGroup ? '' : 'none'
  if (selGroup) document.getElementById('group-info').textContent =
    `${selGroup.memberIds.length} connected shapes`

  // Close/open path toggle
  const pathClosedRow = document.getElementById('path-closed-row')
  const pathClosedBtn = document.getElementById('btn-close-path')
  if (_selShape && _selShape.type === 'path' && _selShape.nodes) {
    pathClosedRow.style.display = ''
    pathClosedBtn.textContent = _selShape.closed ? 'close' : 'open'
  } else {
    pathClosedRow.style.display = 'none'
  }

  // Transform panel
  const tfPanel = document.getElementById('transform-panel')
  if (_selShape) {
    tfPanel.style.display = ''
    syncTransformPanel(_selShape)
  } else {
    tfPanel.style.display = 'none'
  }

  // Align panel — show when 2+ shapes selected
  const allSelIds = [...multiSelected]
  if (selected !== null && !multiSelected.has(selected)) allSelIds.push(selected)
  const alignPanel = document.getElementById('align-panel')
  alignPanel.style.display = allSelIds.length >= 2 ? '' : 'none'

  // Boolean ops row — show when exactly 2 shapes selected, both paths
  const boolRow = document.getElementById('bool-ops-row')
  if (allSelIds.length === 2) {
    const s1 = shapes.find(s => s.id === allSelIds[0])
    const s2 = shapes.find(s => s.id === allSelIds[1])
    boolRow.style.display = (s1 && s2 && s1.type === 'path' && s2.type === 'path') ? '' : 'none'
  } else {
    boolRow.style.display = 'none'
  }

  autoSave()
}

function shapeToSvg(s) {
  if (s.hidden) return ''
  const a   = svgAttrs(s)
  const g   = getGroupOf(s.id)
  const sel = s.id === selected || (g && g.memberIds.includes(selected)) || multiSelected.has(s.id)
  const b   = getShapeBounds(s)
  const rotAttr = (s.rotation && b) ? ` transform="rotate(${s.rotation},${r(b.x+b.w/2)},${r(b.y+b.h/2)})"` : ''

  if (s.type === 'path') {
    const d = pathD(s)
    return `<path d="${d}" ${a}${rotAttr}/>`
         + (sel ? `<path d="${d}" fill="none" stroke="#4ade80" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4" pointer-events="none"${rotAttr}/>` : '')
  }
  if (s.type === 'ellipse') {
    return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" ${a}${rotAttr}/>`
         + (sel ? `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="none" stroke="#4ade80" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4" pointer-events="none"${rotAttr}/>` : '')
  }
  if (s.type === 'rect') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" ${a}${rotAttr}/>`
         + (sel ? `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="none" stroke="#4ade80" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4" pointer-events="none"${rotAttr}/>` : '')
  }
  return ''
}

function svgAttrs(s) {
  const parts = [
    `stroke="${s.stroke || 'none'}"`,
    `fill="${s.fill || 'none'}"`,
    `stroke-width="${s['stroke-width'] ?? 1.5}"`,
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
  ]
  if (s.opacity != null && s.opacity !== 1) parts.push(`opacity="${s.opacity}"`)
  if (s.strokeDash) parts.push(`stroke-dasharray="${s.strokeDash}"`)
  if (s['fill-rule']) parts.push(`fill-rule="${s['fill-rule']}"`)
  return parts.join(' ')
}

function shapeName(s) {
  if (s.type === 'ellipse') return `ellipse ${s.rx}×${s.ry} @(${s.cx},${s.cy})`
  if (s.type === 'rect')    return `rect ${s.w}×${s.h} @(${s.x},${s.y})`
  if (s.d && !s.nodes)      return `shape #${s.id}`
  return `path #${s.id}`
}

// ── Selection ──────────────────────────────────────────────────────────────
function selectShape(id, e) {
  const shape = shapes.find(s => s.id === id)
  if (e && e.shiftKey) {
    if (multiSelected.has(id)) { multiSelected.delete(id) }
    else { if (selected !== null) multiSelected.add(selected); multiSelected.add(id) }
    selected = id; selectedNode = null
    syncPropsPanel(shape)
    render()
    return
  }
  multiSelected.clear()
  selected = id
  selectedNode = null
  syncPropsPanel(shape)
  if (shape) syncTransformPanel(shape)
  document.getElementById('expand-panel').style.display =
    (shape && shape.type === 'path' && shape.nodes) ? '' : 'none'
  render()
}

function deleteShape(id) {
  saveState()
  shapes = shapes.filter(s => s.id !== id)
  if (selected === id) { selected = null; selectedNode = null }
  multiSelected.delete(id)
  for (const g of groups) g.memberIds = g.memberIds.filter(mid => mid !== id)
  groups = groups.filter(g => g.memberIds.length >= 2)
  render()
}

function deleteMultiSelected() {
  if (multiSelected.size === 0) return
  saveState()
  const ids = new Set(multiSelected)
  shapes = shapes.filter(s => !ids.has(s.id))
  if (ids.has(selected)) { selected = null; selectedNode = null }
  for (const g of groups) g.memberIds = g.memberIds.filter(mid => !ids.has(mid))
  groups = groups.filter(g => g.memberIds.length >= 2)
  multiSelected.clear()
  render()
}

// ── Code output ────────────────────────────────────────────────────────────
function updateCode() {
  document.getElementById('code-output').value = shapes.map(s => {
    const a = svgAttrs(s)
    if (s.type === 'path')
      return `<path\n  d="${pathD(s)}"\n  ${a}/>`
    if (s.type === 'ellipse')
      return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}"\n  ${a}/>`
    if (s.type === 'rect')
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"\n  ${a}/>`
    return ''
  }).join('\n\n')
}

function copyCode() {
  navigator.clipboard.writeText(document.getElementById('code-output').value)
    .then(() => flash('copy-inner-btn', 'copied!'))
}

function copyFull() {
  const inner = document.getElementById('code-output').value
  navigator.clipboard.writeText(
    `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">\n${inner}\n</svg>`
  ).then(() => flash('copy-full-btn', 'copied!'))
}

function flash(id, msg) {
  const btn = document.getElementById(id), orig = btn.textContent
  btn.textContent = msg; btn.style.color = '#4ade80'
  setTimeout(() => { btn.textContent = orig; btn.style.color = '' }, 1400)
}

// ── Expand to Shape ────────────────────────────────────────────────────────
function setExpandMode(mode) {
  expandMode = mode
  document.getElementById('exp-uniform').classList.toggle('active', mode === 'uniform')
  document.getElementById('exp-taper').classList.toggle('active', mode === 'taper')
  document.getElementById('exp-row-uniform').style.display = mode === 'uniform' ? '' : 'none'
  document.getElementById('exp-row-taper').style.display   = mode === 'taper'   ? '' : 'none'
}

function setStartCap(cap) {
  expandStartCap = cap
  ;['flat','round','point'].forEach(c =>
    document.getElementById('cap-s-' + c).classList.toggle('active', c === cap)
  )
}

function setEndCap(cap) {
  expandEndCap = cap
  ;['flat','round','point'].forEach(c =>
    document.getElementById('cap-e-' + c).classList.toggle('active', c === cap)
  )
}

// Sample N points per segment along a path shape
function samplePath(shape, nPerSeg) {
  const { nodes, segs, cps } = shape
  if (!nodes || nodes.length < 2) return []
  const pts = [{ x: nodes[0].x, y: nodes[0].y }]
  for (let i = 1; i < nodes.length; i++) {
    const p0 = nodes[i - 1], p1 = nodes[i]
    const seg = segs[i], cp = cps[i]
    for (let t = 1; t <= nPerSeg; t++) {
      const u = t / nPerSeg
      if (seg === 'C' && cp) {
        pts.push({
          x: cubicB(p0.x, cp.cp1x, cp.cp2x, p1.x, u),
          y: cubicB(p0.y, cp.cp1y, cp.cp2y, p1.y, u),
        })
      } else if (seg === 'Q' && cp) {
        pts.push({
          x: quadB(p0.x, cp.cx, p1.x, u),
          y: quadB(p0.y, cp.cy, p1.y, u),
        })
      } else {
        pts.push({ x: p0.x + u * (p1.x - p0.x), y: p0.y + u * (p1.y - p0.y) })
      }
    }
  }
  return pts
}



// Compute left-hand unit normals at each sample point

function expandSelected() {
  const shape = shapes.find(s => s.id === selected)
  if (!shape || shape.type !== 'path' || !shape.nodes) return

  const nPerSeg = 24
  const samples = samplePath(shape, nPerSeg)
  if (samples.length < 2) return
  const normals = computeNormals(samples)
  const n = samples.length

  const w  = parseFloat(document.getElementById('exp-width').value)   || 8
  const sw = parseFloat(document.getElementById('exp-start-w').value) || 10
  const ew = parseFloat(document.getElementById('exp-end-w').value)   || 4
  const startHW = (expandMode === 'taper' ? sw : w) / 2
  const endHW   = (expandMode === 'taper' ? ew : w) / 2

  // Build left and right offset point arrays
  const L = [], R = []
  for (let i = 0; i < n; i++) {
    const t  = n > 1 ? i / (n - 1) : 0
    const hw = startHW + t * (endHW - startHW)
    const { x, y } = samples[i]
    const { nx, ny } = normals[i]
    L.push({ x: r(x + nx * hw), y: r(y + ny * hw) })
    R.push({ x: r(x - nx * hw), y: r(y - ny * hw) })
  }

  const sL = L[0], sR = R[0], sC = samples[0]
  const eL = L[n - 1], eR = R[n - 1], eC = samples[n - 1]

  let d = ''

  // ── Start cap ──
  if (expandStartCap === 'round') {
    // Arc from sR to sL going around the back of the start
    d = `M ${sR.x} ${sR.y} A ${r(startHW)} ${r(startHW)} 0 0 1 ${sL.x} ${sL.y}`
  } else if (expandStartCap === 'point') {
    // Converge at centerline point, then spread to left side
    d = `M ${r(sC.x)} ${r(sC.y)} L ${sL.x} ${sL.y}`
  } else {
    // Flat: just cross from right to left side
    d = `M ${sR.x} ${sR.y} L ${sL.x} ${sL.y}`
  }

  // ── Left side forward ──
  for (let i = 1; i < n; i++) d += ` L ${L[i].x} ${L[i].y}`

  // ── End cap ──
  if (expandEndCap === 'round') {
    d += ` A ${r(endHW)} ${r(endHW)} 0 0 1 ${eR.x} ${eR.y}`
  } else if (expandEndCap === 'point') {
    d += ` L ${r(eC.x)} ${r(eC.y)} L ${eR.x} ${eR.y}`
  } else {
    // Flat
    d += ` L ${eR.x} ${eR.y}`
  }

  // ── Right side backward ──
  for (let i = n - 2; i >= 0; i--) d += ` L ${R[i].x} ${R[i].y}`

  // ── Close (start cap) ──
  if (expandStartCap === 'point') d += ` L ${r(sC.x)} ${r(sC.y)}`
  d += ' Z'

  // Determine fill: prefer current fill if set, else use stroke color, else green
  const fillColor = !document.getElementById('prop-fill-none').checked
    ? document.getElementById('prop-fill').value
    : (shape.stroke !== 'none' ? shape.stroke : '#4ade80')

  const expanded = {
    type: 'path',
    d,
    stroke: 'none',
    fill: fillColor,
    'stroke-width': 0,
    opacity: shape.opacity ?? 1,
  }

  shapes = shapes.filter(s => s.id !== selected)
  selected = null
  commitShape(expanded)
}

// ── AI Generate (local shape generator) ────────────────────────────────────
function setAiStatus(msg, cls) {
  const el = document.getElementById('ai-status')
  el.textContent = msg
  el.className = cls || ''
}

function toggleGeminiKey() {
  const row = document.getElementById('ai-key-row')
  const visible = row.style.display !== 'none'
  row.style.display = visible ? 'none' : ''
  if (!visible && geminiKey) document.getElementById('ai-key').value = ''
  const btn = document.getElementById('ai-key-toggle')
  btn.style.color = geminiKey ? '#4ade80' : ''
  btn.style.borderColor = geminiKey ? '#4ade8066' : ''
}

function saveGeminiKey() {
  const val = document.getElementById('ai-key').value.trim()
  geminiKey = val
  if (val) localStorage.setItem('jv_gemini_key', val)
  else localStorage.removeItem('jv_gemini_key')
  document.getElementById('ai-key-row').style.display = 'none'
  const btn = document.getElementById('ai-key-toggle')
  btn.style.color = val ? '#4ade80' : ''
  btn.style.borderColor = val ? '#4ade8066' : ''
  setAiStatus(val ? 'Gemini key saved — full AI enabled.' : 'Key cleared. Using local shapes.', 'ok')
}

async function aiGenerate() {
  const raw = document.getElementById('ai-prompt').value.trim()
  if (!raw) return

  // ── Gemini path ──
  if (geminiKey) {
    const btn = document.getElementById('ai-gen-btn')
    btn.textContent = '…'; btn.disabled = true
    setAiStatus('Generating…', '')
    try {
      const sysPrompt = `You are a vector art generator for a 200×200 SVG canvas (center 100,100).
Output ONLY a valid JSON array of shape objects — no markdown, no explanation.

Shape formats:
Ellipse: {"type":"ellipse","cx":N,"cy":N,"rx":N,"ry":N,"stroke":"#hex","fill":"#hex or none","stroke-width":N,"opacity":1}
Rect:    {"type":"rect","x":N,"y":N,"w":N,"h":N,"stroke":"#hex","fill":"#hex or none","stroke-width":N,"opacity":1}
Path:    {"type":"path","nodes":[{"x":N,"y":N,"locked":false},...], "segs":[null,"L"|"C",...], "cps":[null,null|{"cp1x":N,"cp1y":N,"cp2x":N,"cp2y":N},...], "closed":false|true, "stroke":"#hex","fill":"#hex or none","stroke-width":N,"opacity":1}
  segs[0] and cps[0] are always null. Cubic bezier: segs[i]="C", cps[i]={"cp1x":N,"cp1y":N,"cp2x":N,"cp2y":N}. Straight: segs[i]="L", cps[i]=null.

Rules: coords 0–200, bright colors on dark bg (#4ade80 green, #60a5fa blue, #f472b6 pink, #facc15 yellow, #e4e4e7 white), fill:"none" for outlines, stroke-width 1–3 normally. Compose multiple shapes as needed. Prefer C segments for organic curves.`

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents: [{ parts: [{ text: raw }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
          }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error?.message || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(clean)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      let added = 0
      for (const s of arr) {
        if (!s || typeof s !== 'object') continue
        if (!['path','ellipse','rect'].includes(s.type)) continue
        if (!s.stroke) s.stroke = '#4ade80'
        if (s.fill === undefined) s.fill = 'none'
        if (s['stroke-width'] == null) s['stroke-width'] = 1.5
        if (s.opacity == null) s.opacity = 1
        if (s.type === 'path' && Array.isArray(s.nodes) && s.nodes.length >= 2) {
          s.nodes = s.nodes.map(n => ({ x: r(n.x), y: r(n.y), locked: false }))
          s.segs[0] = null; s.cps[0] = null
        } else if (s.type !== 'ellipse' && s.type !== 'rect') continue
        s.id = nextId++; shapes.push(s); selected = s.id; added++
      }
      if (added === 0) throw new Error('No valid shapes returned — try rephrasing')
      syncPropsPanel(shapes.find(s => s.id === selected))
      render()
      setAiStatus(`Added ${added} shape${added !== 1 ? 's' : ''}.`, 'ok')
    } catch (err) {
      setAiStatus(err.message, 'error')
    } finally {
      btn.textContent = '✦ Generate'; btn.disabled = false
    }
    return
  }

  // ── Local keyword fallback ──
  const p = raw.toLowerCase()
  const { stroke, fill, sw, scale } = aiStyle(p)
  const results = []
  if (/circle|ellipse|oval|round/.test(p))         results.push(...aiCircle(scale, stroke, fill, sw))
  if (/square|box/.test(p))                         results.push(...aiSquare(scale, stroke, fill, sw))
  if (/rectangle|rect/.test(p))                     results.push(...aiRect(scale, stroke, fill, sw))
  if (/triangle/.test(p))                           results.push(...aiTriangle(scale, stroke, fill, sw))
  if (/\bstar\b/.test(p))                           results.push(...aiStar(scale, stroke, fill, sw))
  if (/heart|love/.test(p))                         results.push(...aiHeart(scale, stroke, fill, sw))
  if (/arrow/.test(p))                              results.push(...aiArrow(p, scale, stroke, fill, sw))
  if (/wave|wavy|water|ocean|sea/.test(p))          results.push(...aiWave(scale, stroke, fill, sw))
  if (/spiral|swirl/.test(p))                       results.push(...aiSpiral(scale, stroke, fill, sw))
  if (/diamond|rhombus/.test(p))                    results.push(...aiDiamond(scale, stroke, fill, sw))
  if (/hexagon|hex/.test(p))                        results.push(...aiHexagon(scale, stroke, fill, sw))
  if (/cross|plus/.test(p))                         results.push(...aiCross(scale, stroke, fill, sw))
  if (/moon|crescent/.test(p))                      results.push(...aiMoon(scale, stroke, fill, sw))
  if (/mountain|hill|peak/.test(p))                 results.push(...aiMountain(scale, stroke, fill, sw))
  if (/\bsun\b|sunny/.test(p))                      results.push(...aiSun(scale, stroke, fill, sw))
  if (/cloud|cloudy/.test(p))                       results.push(...aiCloud(scale, stroke, fill, sw))
  if (/lightning|bolt|thunder/.test(p))             results.push(...aiLightning(scale, stroke, fill, sw))
  if (/leaf|leaves|plant/.test(p))                  results.push(...aiLeaf(scale, stroke, fill, sw))
  if (/flower|daisy|bloom|blossom/.test(p))         results.push(...aiFlower(scale, stroke, fill, sw))
  if (/tree|pine|christmas/.test(p))                results.push(...aiTree(scale, stroke, fill, sw))
  if (/house|home|building/.test(p))                results.push(...aiHouse(scale, stroke, fill, sw))
  if (/\bfish\b|aquatic/.test(p))                    results.push(...aiFish(scale, stroke, fill, sw))
  if (/tadpole/.test(p))                             results.push(...aiTadpole(scale, stroke, fill, sw))
  if (/\bfrog\b|toad/.test(p))                       results.push(...aiFrog(scale, stroke, fill, sw))
  if (/\bcat\b|kitten|kitty/.test(p))                results.push(...aiCat(scale, stroke, fill, sw))
  if (/rabbit|bunny|hare/.test(p))                   results.push(...aiRabbit(scale, stroke, fill, sw))
  if (/mushroom|toadstool/.test(p))                  results.push(...aiMushroom(scale, stroke, fill, sw))
  if (/bird|dove|wings|flying/.test(p))             results.push(...aiBird(scale, stroke, fill, sw))
  if (/flame|fire|torch/.test(p))                   results.push(...aiFlame(scale, stroke, fill, sw))
  if (/gear|cog|wheel/.test(p))                     results.push(...aiGear(scale, stroke, fill, sw))
  if (/anchor|nautical/.test(p))                    results.push(...aiAnchor(scale, stroke, fill, sw))
  if (/person|human|figure|stick/.test(p))          results.push(...aiPerson(scale, stroke, fill, sw))
  if (/snake|worm|serpent/.test(p))                 results.push(...aiSnake(scale, stroke, fill, sw))
  if (/\bline\b/.test(p) && !results.length)        results.push(...aiLine(scale, stroke, sw))
  if (!results.length) {
    setAiStatus('Try: circle, triangle, star, heart, fish, frog, tadpole, cat, rabbit, mushroom, bird, cloud, lightning, flame, leaf, flower, tree, house, gear, anchor, wave, spiral, mountain, moon, sun, snake, person, arrow…', 'error')
    return
  }
  for (const s of results) { s.id = nextId++; shapes.push(s); selected = s.id }
  syncPropsPanel(shapes.find(s => s.id === selected))
  render()
  setAiStatus(`Added ${results.length} shape${results.length !== 1 ? 's' : ''}.`, 'ok')
}


// Allow pressing Enter (without Shift) in the prompt textarea to trigger generation
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('ai-prompt')
  if (ta) ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiGenerate() }
  })
})

// ── Nudge selected shape(s) ──────────────────────────────────────────────────
function nudgeSelected(dx, dy) {
  const allSelIds = [...multiSelected]
  if (selected !== null && !multiSelected.has(selected)) allSelIds.push(selected)
  if (!allSelIds.length) return
  saveState()
  for (const id of allSelIds) {
    const shape = shapes.find(s => s.id === id)
    if (!shape || shape.locked) continue
    if (shape.nodes) {
      shape.nodes = shape.nodes.map(n => ({ ...n, x: r(n.x + dx), y: r(n.y + dy) }))
      if (shape.cps) shape.cps = shape.cps.map(cp => {
        if (!cp) return null
        if (cp.cp1x !== undefined)
          return { cp1x: r(cp.cp1x+dx), cp1y: r(cp.cp1y+dy), cp2x: r(cp.cp2x+dx), cp2y: r(cp.cp2y+dy) }
        return { cx: r(cp.cx+dx), cy: r(cp.cy+dy) }
      })
    } else if (shape.type === 'ellipse') {
      shape.cx = r(shape.cx + dx); shape.cy = r(shape.cy + dy)
    } else if (shape.type === 'rect') {
      shape.x = r(shape.x + dx); shape.y = r(shape.y + dy)
    }
  }
  render()
}

// ── Keyboard ───────────────────────────────────────────────────────────────
function onKey(e) {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return

  // While hovering the zoom widget, arrow keys smoothly pan the view
  if (zcHovered && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault()
    panKeys.add(e.key)
    if (!panRafId) panRafId = requestAnimationFrame(panKeyLoop)
    return
  }

  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key === 'z') { e.preventDefault(); undo(); return }
  if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
  if (mod && e.key === 'd') { e.preventDefault(); duplicateSelected(); return }
  if (mod && e.key === 's') { e.preventDefault(); autoSave(); flash('copy-full-btn', 'saved!'); return }
  if (mod && e.key === '0') { e.preventDefault(); resetZoom(); return }
  if (mod && e.key === 'a') { e.preventDefault(); selectAll(); return }
  if (mod && e.key === 'c') { e.preventDefault(); copySelected(); return }
  if (mod && e.key === 'v') { e.preventDefault(); pasteClipboard(); return }

  // Arrow key nudge (only in select mode, not panning)
  if (tool === 'select' && !spaceDown && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowLeft')  nudgeSelected(-step, 0)
    if (e.key === 'ArrowRight') nudgeSelected(step, 0)
    if (e.key === 'ArrowUp')    nudgeSelected(0, -step)
    if (e.key === 'ArrowDown')  nudgeSelected(0, step)
    return
  }

  switch (e.key) {
    case ' ':
      e.preventDefault()
      spaceDown = true
      svgEl.style.cursor = 'grab'
      break
    case 'Escape':
      if (wip && wip.points.length >= 2) { commitPath(); setTool('select') }
      else { cancelWip(); render() }
      break
    case 'Enter':
      if (wip && wip.points.length >= 2) { commitPath(); setTool('select') } break
    case 'Delete':
    case 'Backspace':
      if (selectedNode !== null) { deleteSelectedNode(); break }
      if (multiSelected.size > 0) { deleteMultiSelected(); break }
      if (selected !== null) { deleteShape(selected); break }
      break
    case 's': case 'S': if (!mod) setTool('segment');  break
    case 'l': case 'L': if (!mod) setTool('line');     break
    case 'c': case 'C': if (!mod) setTool('curve');    break
    case 'e': case 'E': if (!mod) setTool('ellipse');  break
    case 'r': case 'R': if (!mod) setTool('rect');     break
    case 'f': case 'F': if (!mod) setTool('freehand'); break
    case 'v': case 'V': if (!mod) setTool('select');   break
    case 'g': case 'G': if (!mod) toggleSnapGrid();    break
  }
}

// ── Select all ───────────────────────────────────────────────────────────────
function selectAll() {
  if (!shapes.length) return
  multiSelected.clear()
  for (const s of shapes) multiSelected.add(s.id)
  selected = shapes[shapes.length - 1].id
  multiSelected.delete(selected)
  syncPropsPanel(shapes.find(s => s.id === selected))
  render()
}

function resetZoom() { viewTransform = { x: 0, y: 0, scale: 1 }; applyViewTransform() }

// ── Expose to HTML event handlers (ES modules don't auto-globalise) ──────────
Object.assign(window, {
  setTool, toggleSnapGrid, undo, redo,
  aiGenerate, toggleGeminiKey, saveGeminiKey,
  updateProps, syncStrokeFromColor, syncFillFromColor, syncColorFromHex,
  togglePathClosed, deleteSelectedNode,
  moveShapeLayer, selectShape, deleteShape,
  toggleShapeVisible, toggleShapeLocked,
  alignShapes, distributeShapes, booleanOp,
  updateCode, copyCode, copyFull,
  setExpandMode, setStartCap, setEndCap, expandSelected,
  downloadSVG, downloadProject, loadProject, importSVGFile,
  ungroupSelected, applyTransformPanel,
  nudgeSelected, copySelected, pasteClipboard, duplicateSelected, selectAll,
  resetZoom, zoomIn, zoomOut, panBy,
})

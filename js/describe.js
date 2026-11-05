// Scene → structured description an AI can reason about — no DOM, no state.
// Every number is in canvas units (200×200, origin top-left, y down).

import { r } from './math.js'
import { normalizePath, sampleShape } from './pathdata.js'

const RS = 64   // points per shape after arc-length resampling

// opts.selectedIds: ids the user has selected
// opts.measureD(d): optional fallback sampler for paths pathdata can't parse
export function describeScene(shapes, groups = [], opts = {}) {
  const sel = new Set(opts.selectedIds || [])
  const items = shapes.map((orig, z) => describeShape(orig, z, groups, opts))
  const relations = findRelations(items)
  const out = {
    format: 'jormunvector.scene/1',
    canvas: { width: 200, height: 200, origin: 'top-left', yAxis: 'down', units: 'px', rotation: 'positive degrees = clockwise on screen' },
    selection: shapes.filter(s => sel.has(s.id)).map(s => ref(s)),
    shapes: items.map(({ _pts, _closed, ...rest }) => rest),
    relations,
  }
  out.summary = summarize(out)
  return out
}

export function ref(s) { return 's' + s.id }

function describeShape(orig, z, groups, opts) {
  const s = JSON.parse(JSON.stringify(orig))
  const nodeEditable = normalizePath(s)
  let smp = sampleShape(s)
  if (!smp && s.d && opts.measureD) smp = opts.measureD(s.d)
  const g = groups.find(g => g.memberIds.includes(orig.id))

  const d = {
    ref: ref(orig),
    label: orig.label || null,
    kind: orig.type === 'path' ? (nodeEditable ? 'path' : 'compound-path') : orig.type,
    editable: orig.type !== 'path' ? 'params' : (nodeEditable ? 'nodes' : 'whole'),
    z,
  }
  if (orig.locked) d.locked = true
  if (orig.hidden) d.hidden = true
  if (g) d.group = 'g' + g.id
  d.style = { stroke: orig.stroke || 'none', fill: orig.fill || 'none', strokeWidth: orig['stroke-width'] ?? 1.5, opacity: orig.opacity ?? 1 }
  if (orig.strokeDash) d.style.dash = orig.strokeDash

  if (orig.type === 'ellipse') d.params = { cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry }
  if (orig.type === 'rect')    d.params = { x: s.x, y: s.y, w: s.w, h: s.h }
  if (orig.type !== 'path' && orig.rotation) d.rotation = orig.rotation

  let pts = null
  if (smp && smp.pts.length) {
    pts = resample(smp.pts, smp.closed, RS)
    const xs = smp.pts.map(p => p.x), ys = smp.pts.map(p => p.y)
    const bx = Math.min(...xs), by = Math.min(...ys)
    d.bounds = { x: r(bx), y: r(by), w: r(Math.max(...xs) - bx), h: r(Math.max(...ys) - by) }
    // Compound paths are several rings glued together: no single area/centroid
    const ring = d.kind !== 'compound-path'
    if (!ring) smp.closed = false
    const filled = d.style.fill !== 'none'
    const area = ring && (smp.closed || filled) ? Math.abs(shoelace(smp.pts)) : 0
    d.center = centroid(smp.pts, area)
    if (area) d.area = r(area)
    d.length = r(polyLen(smp.pts, smp.closed))
    const sym = []
    if (selfSymmetric(pts, d.bounds, 'vertical'))   sym.push('vertical')
    if (selfSymmetric(pts, d.bounds, 'horizontal')) sym.push('horizontal')
    if (sym.length) d.symmetric = sym
  }

  if (nodeEditable) {
    d.closed = !!s.closed
    d.nodes = nodeInfo(s)
    const corners = d.nodes.filter(n => n.joint === 'corner').length
    d.shapeHint = `${d.nodes.length} nodes, ${corners} corners, ${s.segs.filter(x => x === 'C').length} curved segs`
  } else if (orig.type === 'path') {
    d.d = orig.d
  }
  d._pts = pts; d._closed = smp ? smp.closed : false
  return d
}

// Per-node anatomy. `in` = handle arriving at the node, `out` = handle leaving it.
function nodeInfo(s) {
  const { nodes, segs, cps, closed } = s, n = nodes.length
  return nodes.map((nd, i) => {
    const inH  = segs[i] === 'C' && cps[i] ? [cps[i].cp2x, cps[i].cp2y] : null
    const outH = i + 1 < n && segs[i + 1] === 'C' && cps[i + 1] ? [cps[i + 1].cp1x, cps[i + 1].cp1y] : null
    const prev = i > 0 ? nodes[i - 1] : (closed ? nodes[n - 1] : null)
    const next = i < n - 1 ? nodes[i + 1] : (closed ? nodes[0] : null)
    const o = { i, x: nd.x, y: nd.y }
    if (inH) o.in = inH
    if (outH) o.out = outH
    let dIn = null, dOut = null
    if (inH && (inH[0] !== nd.x || inH[1] !== nd.y)) dIn = [nd.x - inH[0], nd.y - inH[1]]
    else if (prev) dIn = [nd.x - prev.x, nd.y - prev.y]
    if (outH && (outH[0] !== nd.x || outH[1] !== nd.y)) dOut = [outH[0] - nd.x, outH[1] - nd.y]
    else if (next) dOut = [next.x - nd.x, next.y - nd.y]
    if (!dIn || !dOut) o.joint = 'end'
    else {
      const turn = angleBetween(dIn, dOut)
      o.joint = turn < 12 ? 'smooth' : 'corner'
      o.turn = Math.round(turn)
    }
    if (nd.locked) o.locked = true
    return o
  })
}

// ── Relations between shapes ────────────────────────────────────────────────
function findRelations(items) {
  const rels = []
  const live = items.filter(d => d._pts && !d.hidden)
  for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
    const A = live[a], B = live[b]
    const area = x => x.area || 0
    // container first, so "contains" reads naturally
    const [big, small] = area(A) >= area(B) ? [A, B] : [B, A]
    if (big._closed && small._pts.every(p => inPoly(p, big._pts))) {
      rels.push({ a: big.ref, rel: 'contains', b: small.ref })
    } else if (boxesOverlap(A.bounds, B.bounds)) {
      const crossing = A._pts.some(p => inPoly(p, B._pts)) || B._pts.some(p => inPoly(p, A._pts))
      const gap = minDist(A._pts, B._pts)
      if (crossing && (A._closed || B._closed)) rels.push({ a: A.ref, rel: 'overlaps', b: B.ref })
      else if (gap < 1.5) rels.push({ a: A.ref, rel: 'touches', b: B.ref })
    } else if (minDist(A._pts, B._pts) < 1.5) {
      rels.push({ a: A.ref, rel: 'touches', b: B.ref })
    }
    const m = mirrorPair(A, B)
    if (m) rels.push({ a: A.ref, rel: 'mirrors', b: B.ref, ...m })
    if (Math.abs(A.center.x - B.center.x) < 0.6) rels.push({ a: A.ref, rel: 'centered-x', b: B.ref, x: r((A.center.x + B.center.x) / 2) })
    if (Math.abs(A.center.y - B.center.y) < 0.6 && !m) rels.push({ a: A.ref, rel: 'centered-y', b: B.ref, y: r((A.center.y + B.center.y) / 2) })
  }
  return rels
}

// Left/right (or top/bottom) mirror images of each other
function mirrorPair(A, B) {
  const size = Math.max(A.bounds.w, A.bounds.h, B.bounds.w, B.bounds.h, 1)
  if (Math.abs(A.bounds.w - B.bounds.w) > size * 0.06 || Math.abs(A.bounds.h - B.bounds.h) > size * 0.06) return null
  const tol = Math.max(1, size * 0.04)
  if (Math.abs(A.center.y - B.center.y) < tol && Math.abs(A.center.x - B.center.x) > tol) {
    const ax = (A.center.x + B.center.x) / 2
    const flipped = A._pts.map(p => ({ x: 2 * ax - p.x, y: p.y }))
    if (meanNearest(flipped, B._pts) < tol) return { axis: 'vertical', x: r(ax) }
  }
  if (Math.abs(A.center.x - B.center.x) < tol && Math.abs(A.center.y - B.center.y) > tol) {
    const ay = (A.center.y + B.center.y) / 2
    const flipped = A._pts.map(p => ({ x: p.x, y: 2 * ay - p.y }))
    if (meanNearest(flipped, B._pts) < tol) return { axis: 'horizontal', y: r(ay) }
  }
  return null
}

function selfSymmetric(pts, b, axis) {
  if (!b || (b.w < 1 && b.h < 1)) return false
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const f = axis === 'vertical' ? pts.map(p => ({ x: 2 * cx - p.x, y: p.y })) : pts.map(p => ({ x: p.x, y: 2 * cy - p.y }))
  return meanNearest(f, pts) < Math.max(0.5, Math.max(b.w, b.h) * 0.02)
}

// ── Human/LLM-readable digest ───────────────────────────────────────────────
function summarize(scene) {
  const L = []
  L.push(`Canvas 200x200, origin top-left, y down. ${scene.shapes.length} shapes listed back-to-front.`)
  if (scene.selection.length) L.push(`Selected: ${scene.selection.join(', ')}.`)
  for (const s of scene.shapes) {
    const name = s.label ? ` "${s.label}"` : ''
    const geo = s.bounds ? ` center (${s.center.x},${s.center.y}) size ${s.bounds.w}x${s.bounds.h}` : ''
    const st = [s.style.fill !== 'none' ? `fill ${s.style.fill}` : 'no fill', s.style.stroke !== 'none' ? `stroke ${s.style.stroke} ${s.style.strokeWidth}` : 'no stroke'].join(', ')
    const extra = [s.shapeHint, s.symmetric ? `symmetric ${s.symmetric.join('+')}` : '', s.locked ? 'LOCKED' : '', s.hidden ? 'hidden' : ''].filter(Boolean).join('; ')
    L.push(`${s.ref}${name}: ${s.kind}${geo}; ${st}${extra ? '; ' + extra : ''}`)
  }
  for (const x of scene.relations) {
    const at = x.axis ? ` (${x.axis} axis at ${x.axis === 'vertical' ? 'x=' + x.x : 'y=' + x.y})` : ''
    L.push(`${x.a} ${x.rel} ${x.b}${at}`)
  }
  return L.join('\n')
}

// ── Geometry helpers ────────────────────────────────────────────────────────
function resample(pts, closed, n) {
  const ring = closed ? [...pts, pts[0]] : pts
  const seg = []; let tot = 0
  for (let i = 1; i < ring.length; i++) { const l = Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y); seg.push(l); tot += l }
  if (!tot) return [pts[0]]
  const out = [], step = tot / (closed ? n : n - 1)
  let i = 0, acc = 0
  for (let k = 0; k < n; k++) {
    const want = k * step
    while (i < seg.length - 1 && acc + seg[i] < want) { acc += seg[i]; i++ }
    const t = seg[i] ? Math.min(1, (want - acc) / seg[i]) : 0
    out.push({ x: ring[i].x + (ring[i + 1].x - ring[i].x) * t, y: ring[i].y + (ring[i + 1].y - ring[i].y) * t })
  }
  return out
}

function shoelace(p) {
  let a = 0
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i].x * p[j].y - p[j].x * p[i].y }
  return a / 2
}

function centroid(p, area) {
  if (area > 0.5) {
    const A = shoelace(p); let cx = 0, cy = 0
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length, f = p[i].x * p[j].y - p[j].x * p[i].y
      cx += (p[i].x + p[j].x) * f; cy += (p[i].y + p[j].y) * f
    }
    return { x: r(cx / (6 * A)), y: r(cy / (6 * A)) }
  }
  const xs = p.map(q => q.x), ys = p.map(q => q.y)
  return { x: r((Math.min(...xs) + Math.max(...xs)) / 2), y: r((Math.min(...ys) + Math.max(...ys)) / 2) }
}

function polyLen(p, closed) {
  let l = 0
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
  if (closed && p.length > 1) l += Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y)
  return l
}

function angleBetween(u, v) {
  const lu = Math.hypot(...u), lv = Math.hypot(...v)
  if (!lu || !lv) return 0
  const c = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))
  return Math.acos(c) * 180 / Math.PI
}

function inPoly(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function boxesOverlap(a, b) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

function minDist(A, B) {
  let m = Infinity
  for (const p of A) for (const q of B) { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < m) m = d }
  return Math.sqrt(m)
}

function meanNearest(A, B) {
  const one = (X, Y) => X.reduce((s, p) => {
    let m = Infinity
    for (const q of Y) { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < m) m = d }
    return s + Math.sqrt(m)
  }, 0) / X.length
  return Math.max(one(A, B), one(B, A))
}

// SVG path-data parsing, normalisation and geometry — no DOM, no state.
// Shared by describe.js and ops.js so both see the exact same node numbering.

import { r, cubicB } from './math.js'

// ── Parse a `d` string into absolute commands ───────────────────────────────
// Output: [{ c:'M'|'L'|'C'|'Q'|'A'|'Z', ... }] — H/V become L, S/T become C/Q.
export function parseD(d) {
  const toks = String(d).match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || []
  const out = []
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lastCp = null, lastQ = null
  const num = () => { const v = parseFloat(toks[i++]); if (Number.isNaN(v)) throw new Error('bad number'); return v }
  const isNum = () => i < toks.length && !/^[a-z]$/i.test(toks[i])
  while (i < toks.length) {
    if (/^[a-z]$/i.test(toks[i])) cmd = toks[i++]
    else if (!cmd) throw new Error('path must start with a command')
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()
    const ax = v => rel ? x + v : v, ay = v => rel ? y + v : v
    if (C === 'Z') {
      out.push({ c: 'Z' }); x = sx; y = sy; lastCp = lastQ = null
      if (isNum()) throw new Error('numbers after Z')
      continue
    }
    do {
      if (C === 'M') {
        x = ax(num()); y = ay(num()); sx = x; sy = y
        out.push({ c: 'M', x, y }); cmd = rel ? 'l' : 'L'; lastCp = lastQ = null
        break   // implicit lineto pairs handled by the L branch on the next loop pass
      } else if (C === 'L') {
        x = ax(num()); y = ay(num()); out.push({ c: 'L', x, y }); lastCp = lastQ = null
      } else if (C === 'H') {
        x = rel ? x + num() : num(); out.push({ c: 'L', x, y }); lastCp = lastQ = null
      } else if (C === 'V') {
        y = rel ? y + num() : num(); out.push({ c: 'L', x, y }); lastCp = lastQ = null
      } else if (C === 'C' || C === 'S') {
        let x1, y1
        if (C === 'C') { x1 = ax(num()); y1 = ay(num()) }
        else { x1 = lastCp ? 2 * x - lastCp.x : x; y1 = lastCp ? 2 * y - lastCp.y : y }
        const x2 = ax(num()), y2 = ay(num()), ex = ax(num()), ey = ay(num())
        out.push({ c: 'C', x1, y1, x2, y2, x: ex, y: ey })
        lastCp = { x: x2, y: y2 }; lastQ = null; x = ex; y = ey
      } else if (C === 'Q' || C === 'T') {
        let qx, qy
        if (C === 'Q') { qx = ax(num()); qy = ay(num()) }
        else { qx = lastQ ? 2 * x - lastQ.x : x; qy = lastQ ? 2 * y - lastQ.y : y }
        const ex = ax(num()), ey = ay(num())
        out.push({ c: 'Q', qx, qy, x: ex, y: ey })
        lastQ = { x: qx, y: qy }; lastCp = null; x = ex; y = ey
      } else if (C === 'A') {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num()
        const ex = ax(num()), ey = ay(num())
        out.push({ c: 'A', rx, ry, rot, large, sweep, x: ex, y: ey, x0: x, y0: y })
        lastCp = lastQ = null; x = ex; y = ey
      } else throw new Error('unsupported command ' + cmd)
    } while (isNum())
  }
  return out
}

export function serializeD(cmds) {
  return cmds.map(k => {
    switch (k.c) {
      case 'M': return `M ${r(k.x)} ${r(k.y)}`
      case 'L': return `L ${r(k.x)} ${r(k.y)}`
      case 'C': return `C ${r(k.x1)} ${r(k.y1)}, ${r(k.x2)} ${r(k.y2)}, ${r(k.x)} ${r(k.y)}`
      case 'Q': return `Q ${r(k.qx)} ${r(k.qy)}, ${r(k.x)} ${r(k.y)}`
      case 'A': return `A ${r(k.rx)} ${r(k.ry)} ${r(k.rot)} ${k.large ? 1 : 0} ${k.sweep ? 1 : 0} ${r(k.x)} ${r(k.y)}`
      case 'Z': return 'Z'
    }
    return ''
  }).join(' ')
}

// ── Affine matrices [a,b,c,d,e,f]: x' = a·x + c·y + e, y' = b·x + d·y + f ──
// Positive degrees rotate clockwise on screen (y points down), same as SVG rotate().
export const M = {
  translate: (dx, dy) => [1, 0, 0, 1, dx, dy],
  scale: (sx, sy, ox, oy) => [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy],
  rotate(deg, ox, oy) {
    const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t)
    return [c, s, -s, c, ox - c * ox + s * oy, oy - s * ox - c * oy]
  },
}
export function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] }

export function transformCmds(cmds, m) {
  const det = m[0] * m[3] - m[1] * m[2], k = Math.sqrt(Math.abs(det))
  const rotDeg = Math.atan2(m[1], m[0]) * 180 / Math.PI
  return cmds.map(c => {
    const o = { ...c }
    if ('x' in c) [o.x, o.y] = apply(m, c.x, c.y)
    if ('x0' in c) [o.x0, o.y0] = apply(m, c.x0, c.y0)
    if (c.c === 'C') { [o.x1, o.y1] = apply(m, c.x1, c.y1); [o.x2, o.y2] = apply(m, c.x2, c.y2) }
    if (c.c === 'Q') [o.qx, o.qy] = apply(m, c.qx, c.qy)
    if (c.c === 'A') {
      // Exact for similarity transforms; non-uniform scale of an arc is approximated
      o.rx = c.rx * k; o.ry = c.ry * k; o.rot = c.rot + rotDeg
      if (det < 0) o.sweep = c.sweep ? 0 : 1
    }
    return o
  })
}

// ── Node-model conversion ───────────────────────────────────────────────────
// The editor's path model: nodes[], segs[] ('L'|'C'|'Q', [0]=null), cps[], closed.
// Returns null for paths that do not fit it (several subpaths, or arcs).
export function cmdsToNodes(cmds) {
  if (!cmds.length || cmds[0].c !== 'M') return null
  const nodes = [{ x: r(cmds[0].x), y: r(cmds[0].y), locked: false }], segs = [null], cps = [null]
  let closed = false
  for (let i = 1; i < cmds.length; i++) {
    const k = cmds[i]
    if (closed) return null                       // anything after Z = another subpath
    if (k.c === 'M' || k.c === 'A') return null
    if (k.c === 'Z') { closed = true; continue }
    nodes.push({ x: r(k.x), y: r(k.y), locked: false })
    if (k.c === 'L') { segs.push('L'); cps.push(null) }
    else if (k.c === 'C') { segs.push('C'); cps.push({ cp1x: r(k.x1), cp1y: r(k.y1), cp2x: r(k.x2), cp2y: r(k.y2) }) }
    else if (k.c === 'Q') { segs.push('Q'); cps.push({ cx: r(k.qx), cy: r(k.qy) }) }
  }
  // An explicit straight line back to the start is redundant with Z
  if (closed && nodes.length > 2 && segs[segs.length - 1] === 'L') {
    const a = nodes[0], b = nodes[nodes.length - 1]
    if (Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05) { nodes.pop(); segs.pop(); cps.pop() }
  }
  if (nodes.length < 2) return null
  return { nodes, segs, cps, closed }
}

export function nodesToCmds(s) {
  const cmds = [{ c: 'M', x: s.nodes[0].x, y: s.nodes[0].y }]
  for (let i = 1; i < s.nodes.length; i++) {
    const n = s.nodes[i], cp = s.cps[i]
    if (s.segs[i] === 'C' && cp) cmds.push({ c: 'C', x1: cp.cp1x, y1: cp.cp1y, x2: cp.cp2x, y2: cp.cp2y, x: n.x, y: n.y })
    else if (s.segs[i] === 'Q' && cp) cmds.push({ c: 'Q', qx: cp.cx, qy: cp.cy, x: n.x, y: n.y })
    else cmds.push({ c: 'L', x: n.x, y: n.y })
  }
  if (s.closed) cmds.push({ c: 'Z' })
  return cmds
}

// Same rule as app.js getShapeBounds(): the box the renderer rotates about
export function nodeBounds(nodes) {
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x: r(x), y: r(y), w: r(Math.max(...xs) - x), h: r(Math.max(...ys) - y) }
}

// Bring a path into canonical editable form, in place:
// raw `d` → nodes (when it fits), Q → C (exact degree elevation), rotation baked in.
// Node indices are unchanged by any of these, so describe and ops agree.
// Returns true when the shape is node-editable afterwards.
export function normalizePath(s) {
  if (s.type !== 'path') return false
  if (!s.nodes && s.d) {
    let cmds
    try { cmds = parseD(s.d) } catch { return false }
    const nm = cmdsToNodes(cmds)
    if (!nm) return false
    Object.assign(s, nm); delete s.d
  }
  if (!s.nodes || s.nodes.length < 2) return false
  if (s.d) delete s.d                            // nodes are the source of truth once present
  for (let i = 1; i < s.nodes.length; i++) {
    if (s.segs[i] === 'Q' && s.cps[i]) {
      const p0 = s.nodes[i - 1], p1 = s.nodes[i], q = s.cps[i]
      s.segs[i] = 'C'
      s.cps[i] = {
        cp1x: r(p0.x + 2 / 3 * (q.cx - p0.x)), cp1y: r(p0.y + 2 / 3 * (q.cy - p0.y)),
        cp2x: r(p1.x + 2 / 3 * (q.cx - p1.x)), cp2y: r(p1.y + 2 / 3 * (q.cy - p1.y)),
      }
    } else if (s.segs[i] !== 'C' || !s.cps[i]) { s.segs[i] = 'L'; s.cps[i] = null }
  }
  if (s.rotation) {
    const b = nodeBounds(s.nodes)
    mapNodePath(s, M.rotate(s.rotation, b.x + b.w / 2, b.y + b.h / 2))
    delete s.rotation
  }
  return true
}

export function mapNodePath(s, m) {
  s.nodes = s.nodes.map(n => { const [x, y] = apply(m, n.x, n.y); return { ...n, x: r(x), y: r(y) } })
  s.cps = s.cps.map(cp => {
    if (!cp) return null
    if ('cp1x' in cp) {
      const [a, b] = apply(m, cp.cp1x, cp.cp1y), [c, d] = apply(m, cp.cp2x, cp.cp2y)
      return { cp1x: r(a), cp1y: r(b), cp2x: r(c), cp2y: r(d) }
    }
    const [a, b] = apply(m, cp.cx, cp.cy)
    return { cx: r(a), cy: r(b) }
  })
}

// ── Sampling (world coordinates, rotation applied) ──────────────────────────
// Returns { pts:[{x,y}], closed } or null when the geometry is unknown.
export function sampleShape(s, perSeg = 12) {
  let pts = [], closed = true
  if (s.type === 'ellipse') {
    const n = 48
    for (let i = 0; i < n; i++) {
      const t = i / n * 2 * Math.PI
      pts.push({ x: s.cx + s.rx * Math.cos(t), y: s.cy + s.ry * Math.sin(t) })
    }
    if (s.rotation) pts = rotPts(pts, s.rotation, s.cx, s.cy)
    return { pts, closed }
  }
  if (s.type === 'rect') {
    pts = [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }]
    if (s.rotation) pts = rotPts(pts, s.rotation, s.x + s.w / 2, s.y + s.h / 2)
    return { pts, closed }
  }
  if (s.type !== 'path') return null
  let cmds
  if (s.nodes && !s.d) cmds = nodesToCmds(s)
  else { try { cmds = parseD(s.d) } catch { return null } }
  closed = cmds.some(c => c.c === 'Z')
  let cx = 0, cy = 0
  for (const k of cmds) {
    if (k.c === 'M' || k.c === 'L') pts.push({ x: k.x, y: k.y })
    else if (k.c === 'C') for (let j = 1; j <= perSeg; j++) {
      const t = j / perSeg
      pts.push({ x: cubicB(cx, k.x1, k.x2, k.x, t), y: cubicB(cy, k.y1, k.y2, k.y, t) })
    } else if (k.c === 'Q') for (let j = 1; j <= perSeg; j++) {
      const t = j / perSeg, m = 1 - t
      pts.push({ x: m * m * cx + 2 * m * t * k.qx + t * t * k.x, y: m * m * cy + 2 * m * t * k.qy + t * t * k.y })
    } else if (k.c === 'A') pts.push(...arcPts(k, perSeg))
    if ('x' in k) { cx = k.x; cy = k.y }
  }
  // Renderer only rotates node paths (bounds are needed for the pivot)
  if (s.rotation && s.nodes && !s.d) {
    const b = nodeBounds(s.nodes)
    pts = rotPts(pts, s.rotation, b.x + b.w / 2, b.y + b.h / 2)
  }
  return { pts, closed }
}

function rotPts(pts, deg, ox, oy) {
  const m = M.rotate(deg, ox, oy)
  return pts.map(p => { const [x, y] = apply(m, p.x, p.y); return { x, y } })
}

// Endpoint-parameterised arc → points (SVG spec F.6.5)
function arcPts(k, n) {
  let { rx, ry } = k
  const { x0, y0, x, y } = k
  if (!rx || !ry) return [{ x, y }]
  rx = Math.abs(rx); ry = Math.abs(ry)
  const phi = k.rot * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi)
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy
  const lam = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let co = Math.sqrt(Math.max(0, num / den)); if (k.large === k.sweep) co = -co
  const cxp = co * rx * y1 / ry, cyp = -co * ry * x1 / rx
  const ccx = cp * cxp - sp * cyp + (x0 + x) / 2, ccy = sp * cxp + cp * cyp + (y0 + y) / 2
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!k.sweep && dt > 0) dt -= 2 * Math.PI
  if (k.sweep && dt < 0) dt += 2 * Math.PI
  const out = []
  for (let j = 1; j <= n; j++) {
    const t = t1 + dt * j / n
    out.push({ x: ccx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, y: ccy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp })
  }
  return out
}

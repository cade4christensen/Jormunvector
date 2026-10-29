// Edit operations — the small, reviewable changes an AI proposes. No DOM, no state.
// applyOps() never mutates its input: it returns a new shapes array plus a
// per-op result so the UI can preview, toggle and approve each op.

import { r } from './math.js'
import { normalizePath, sampleShape, mapNodePath, parseD, serializeD, transformCmds, M } from './pathdata.js'

export const OPS_SPEC = `Edit operations (JSON). Shapes are referenced by "target": their ref, e.g. "s3".
Coordinates are canvas px (200x200, origin top-left, y down). Positive degrees rotate clockwise.
Node indices are the "i" values in the scene description. A node's "in" handle arrives at it, "out" leaves it.
Every op may include "why": a short reason shown to the user.

Whole-shape ops (any kind):
  {"op":"move","target":"s3","dx":2,"dy":-1}
  {"op":"scale","target":"s3","sx":1.1,"sy":1.1,"origin":[100,100]}   (sy defaults to sx; origin defaults to the shape's center)
  {"op":"rotate","target":"s3","deg":15,"origin":[100,100]}           (origin optional)
  {"op":"mirror","target":"s3","axis":"vertical","at":100}            (vertical axis = flip left/right; at defaults to the shape's center)
  {"op":"set_style","target":"s3","stroke":"#hex|none","fill":"#hex|none","stroke-width":1.5,"opacity":1}   (any subset)
  {"op":"label","target":"s3","name":"left ear"}
  {"op":"reorder","target":"s3","to":"front|back|forward|backward"}
  {"op":"duplicate","target":"s3","dx":10,"dy":0,"as":"copy1"}        ("as" lets later ops target the copy)
  {"op":"delete","target":"s3"}
Primitive params (ellipse: cx cy rx ry; rect: x y w h):
  {"op":"set_params","target":"s2","rx":12}
Node ops (only shapes with editable "nodes"):
  {"op":"move_node","target":"s3","node":4,"dx":1.5,"dy":0}           (the node's handles travel with it)
  {"op":"set_node","target":"s3","node":4,"x":120,"y":80}
  {"op":"move_handle","target":"s3","node":4,"handle":"in|out","dx":0,"dy":-3}
  {"op":"set_handle","target":"s3","node":4,"handle":"in|out","x":118,"y":76}
  {"op":"smooth_node","target":"s3","node":4}                          (make in/out handles colinear)
  {"op":"set_segment","target":"s3","node":4,"seg":"L|C"}             (segment arriving at node 4: straight or curve)
  {"op":"insert_node","target":"s3","after":4,"t":0.5}                 (split the segment after node 4)
  {"op":"delete_node","target":"s3","node":4}
  {"op":"set_closed","target":"s3","closed":true}
New shapes:
  {"op":"add","as":"new1","shape":{"type":"ellipse","cx":100,"cy":100,"rx":5,"ry":5,"stroke":"#hex","fill":"none","stroke-width":1.5}}
  rect: {"type":"rect","x":N,"y":N,"w":N,"h":N,...}; path: {"type":"path","d":"M ... Z",...}`

export const EDIT_SYSTEM_PROMPT = `You make precise edits to vector art in the Jormunvector editor.
You receive a scene description (JSON: every shape's ref, label, style, bounds, center, nodes with handles, and relations
such as contains / overlaps / touches / mirrors) and usually a rendered PNG where each shape's ref is printed at its center.

Respond with ONLY JSON: {"ops":[...], "note":"one short sentence"}.
Rules:
- Make the SMALLEST set of ops that satisfies the request. Do not touch shapes the request is not about.
- If shapes are selected, assume the request is about them unless it clearly says otherwise.
- Prefer relative ops (move, move_node, move_handle, scale) for nudges; keep mirrored pairs mirrored by editing both.
- Never target shapes or nodes marked locked.
- Label shapes you edit if they have no label and their role is obvious.
- If the request is impossible or unclear, return {"ops":[], "note":"why"}.

${OPS_SPEC}`

// ── Apply ───────────────────────────────────────────────────────────────────
// ops: array of op objects; opts.nextId: next free shape id
// → { shapes, nextId, results: [{ ok, error?, touched:[ids] }] }
export function applyOps(shapes, ops, opts = {}) {
  const work = JSON.parse(JSON.stringify(shapes))
  let nextId = opts.nextId ?? (work.reduce((m, s) => Math.max(m, s.id), 0) + 1)
  const alias = {}
  const results = []
  for (const op of ops) {
    try {
      const touched = applyOne(work, op, alias, () => nextId++)
      results.push({ ok: true, touched })
    } catch (e) {
      results.push({ ok: false, error: e.message, touched: [] })
    }
  }
  return { shapes: work, nextId, results }
}

function applyOne(work, op, alias, newId) {
  if (!op || typeof op !== 'object') throw new Error('not an object')
  const kind = op.op
  if (kind === 'add') return [addShape(work, op, alias, newId)]

  const s = resolve(work, op.target, alias)
  if (s.locked) throw new Error(`${refOf(s)} is locked`)

  switch (kind) {
    case 'move': {
      const dx = num(op.dx, 0), dy = num(op.dy, 0)
      transformWhole(s, M.translate(dx, dy), { dx, dy })
      break
    }
    case 'scale': {
      const sx = num(op.sx), sy = op.sy == null ? sx : num(op.sy)
      if (!sx || !sy) throw new Error('scale factor cannot be 0')
      const [ox, oy] = origin(s, op.origin)
      transformWhole(s, M.scale(sx, sy, ox, oy), { sx, sy, ox, oy })
      break
    }
    case 'rotate': {
      const deg = num(op.deg)
      const [ox, oy] = origin(s, op.origin)
      transformWhole(s, M.rotate(deg, ox, oy), { deg, ox, oy })
      break
    }
    case 'mirror': {
      const [cx, cy] = origin(s)
      if (op.axis === 'vertical') { const at = num(op.at, cx); transformWhole(s, M.scale(-1, 1, at, 0), { sx: -1, sy: 1, ox: at, oy: 0, mirror: true }) }
      else if (op.axis === 'horizontal') { const at = num(op.at, cy); transformWhole(s, M.scale(1, -1, 0, at), { sx: 1, sy: -1, ox: 0, oy: at, mirror: true }) }
      else throw new Error('axis must be "vertical" or "horizontal"')
      break
    }
    case 'set_params': {
      const keys = s.type === 'ellipse' ? ['cx', 'cy', 'rx', 'ry'] : s.type === 'rect' ? ['x', 'y', 'w', 'h'] : null
      if (!keys) throw new Error('set_params only applies to ellipse and rect')
      let any = false
      for (const k of keys) if (op[k] != null) {
        const v = num(op[k])
        if (['rx', 'ry', 'w', 'h'].includes(k) && v <= 0) throw new Error(`${k} must be > 0`)
        s[k] = r(v); any = true
      }
      if (!any) throw new Error(`give at least one of ${keys.join(', ')}`)
      break
    }
    case 'set_style': {
      let any = false
      for (const k of ['stroke', 'fill']) if (op[k] != null) {
        if (!/^(none|#[0-9a-f]{3,8}|[a-z]+)$/i.test(String(op[k]))) throw new Error(`bad ${k} colour`)
        s[k] = op[k]; any = true
      }
      const sw = op['stroke-width'] ?? op.strokeWidth
      if (sw != null) { const v = num(sw); if (v < 0) throw new Error('stroke-width must be >= 0'); s['stroke-width'] = r(v); any = true }
      if (op.opacity != null) { const v = num(op.opacity); if (v < 0 || v > 1) throw new Error('opacity must be 0–1'); s.opacity = v; any = true }
      if (!any) throw new Error('nothing to change')
      break
    }
    case 'label': {
      const name = String(op.name ?? '').trim()
      if (name) s.label = name.slice(0, 60); else delete s.label
      break
    }
    case 'reorder': {
      const i = work.indexOf(s)
      work.splice(i, 1)
      const to = { front: work.length, back: 0, forward: Math.min(work.length, i + 1), backward: Math.max(0, i - 1) }[op.to]
      if (to == null) { work.splice(i, 0, s); throw new Error('to must be front, back, forward or backward') }
      work.splice(to, 0, s)
      break
    }
    case 'duplicate': {
      const copy = JSON.parse(JSON.stringify(s))
      copy.id = newId()
      if (copy.label) copy.label += ' copy'
      work.splice(work.indexOf(s) + 1, 0, copy)
      const dx = num(op.dx, 0), dy = num(op.dy, 0)
      if (dx || dy) transformWhole(copy, M.translate(dx, dy), { dx, dy })
      if (op.as) alias[op.as] = copy.id
      return [copy.id]
    }
    case 'delete':
      work.splice(work.indexOf(s), 1)
      break
    default:
      nodeOp(s, op)
  }
  return [s.id]
}

// ── Node-level ops ──────────────────────────────────────────────────────────
function nodeOp(s, op) {
  const NODE_OPS = ['move_node', 'set_node', 'move_handle', 'set_handle', 'smooth_node', 'set_segment', 'insert_node', 'delete_node', 'set_closed']
  if (!NODE_OPS.includes(op.op)) throw new Error(`unknown op "${op.op}"`)
  if (s.type !== 'path') throw new Error(`${refOf(s)} is a ${s.type}; use set_params`)
  if (!normalizePath(s)) throw new Error(`${refOf(s)} is a compound path; only whole-shape ops apply`)
  const { nodes, segs, cps } = s, n = nodes.length

  if (op.op === 'set_closed') { s.closed = !!op.closed; return }
  if (op.op === 'insert_node') return insertNode(s, idx(op.after, n, 'after'), op.t == null ? 0.5 : num(op.t))

  const i = idx(op.node, n, 'node')
  if (nodes[i].locked) throw new Error(`node ${i} is locked`)

  switch (op.op) {
    case 'move_node':
    case 'set_node': {
      const dx = op.op === 'move_node' ? num(op.dx, 0) : num(op.x) - nodes[i].x
      const dy = op.op === 'move_node' ? num(op.dy, 0) : num(op.y) - nodes[i].y
      nodes[i] = { ...nodes[i], x: r(nodes[i].x + dx), y: r(nodes[i].y + dy) }
      if (segs[i] === 'C') cps[i] = { ...cps[i], cp2x: r(cps[i].cp2x + dx), cp2y: r(cps[i].cp2y + dy) }
      if (i + 1 < n && segs[i + 1] === 'C') cps[i + 1] = { ...cps[i + 1], cp1x: r(cps[i + 1].cp1x + dx), cp1y: r(cps[i + 1].cp1y + dy) }
      return
    }
    case 'move_handle':
    case 'set_handle': {
      const k = handleSeg(s, i, op.handle)
      const [hx, hy] = op.handle === 'in' ? ['cp2x', 'cp2y'] : ['cp1x', 'cp1y']
      if (segs[k] !== 'C') toCurve(s, k)
      const c = { ...cps[k] }
      if (op.op === 'move_handle') { c[hx] = r(c[hx] + num(op.dx, 0)); c[hy] = r(c[hy] + num(op.dy, 0)) }
      else { c[hx] = r(num(op.x)); c[hy] = r(num(op.y)) }
      cps[k] = c
      return
    }
    case 'smooth_node': {
      if (!s.closed && (i === 0 || i === n - 1)) throw new Error('end nodes have only one handle')
      const kin = i === 0 ? null : i, kout = i + 1 < n ? i + 1 : null
      if (!kin || !kout) throw new Error('node sits on the straight closing segment; insert a node first')
      if (segs[kin] !== 'C') toCurve(s, kin)
      if (segs[kout] !== 'C') toCurve(s, kout)
      const nd = nodes[i], a = cps[kin], b = cps[kout]
      const lin = Math.hypot(a.cp2x - nd.x, a.cp2y - nd.y), lout = Math.hypot(b.cp1x - nd.x, b.cp1y - nd.y)
      let dx = (b.cp1x - nd.x) / (lout || 1) - (a.cp2x - nd.x) / (lin || 1)
      let dy = (b.cp1y - nd.y) / (lout || 1) - (a.cp2y - nd.y) / (lin || 1)
      const l = Math.hypot(dx, dy)
      if (!l) { dx = nodes[i + 1].x - nodes[i - 1].x; dy = nodes[i + 1].y - nodes[i - 1].y } else { dx /= l; dy /= l }
      const ll = Math.hypot(dx, dy) || 1; dx /= ll; dy /= ll
      const li = lin || Math.hypot(nd.x - nodes[i - 1].x, nd.y - nodes[i - 1].y) / 3
      const lo = lout || Math.hypot(nodes[i + 1].x - nd.x, nodes[i + 1].y - nd.y) / 3
      cps[kin] = { ...a, cp2x: r(nd.x - dx * li), cp2y: r(nd.y - dy * li) }
      cps[kout] = { ...b, cp1x: r(nd.x + dx * lo), cp1y: r(nd.y + dy * lo) }
      return
    }
    case 'set_segment': {
      if (i === 0) throw new Error('node 0 has no arriving segment')
      if (op.seg === 'L') { segs[i] = 'L'; cps[i] = null }
      else if (op.seg === 'C') { if (segs[i] !== 'C') toCurve(s, i) }
      else throw new Error('seg must be "L" or "C"')
      return
    }
    case 'delete_node': {
      if (n <= (s.closed ? 3 : 2)) throw new Error('path would have too few nodes')
      nodes.splice(i, 1); segs.splice(i, 1); cps.splice(i, 1)
      segs[0] = null; cps[0] = null
      return
    }
  }
}

// Segment index holding a node's in/out handle
function handleSeg(s, i, h) {
  if (h === 'in') { if (i === 0) throw new Error('node 0 has no "in" handle'); return i }
  if (h === 'out') { if (i + 1 >= s.nodes.length) throw new Error(`node ${i} has no "out" handle (closing segment is straight)`); return i + 1 }
  throw new Error('handle must be "in" or "out"')
}

// Straight segment k → cubic with handles at the thirds (same visible line)
function toCurve(s, k) {
  const a = s.nodes[k - 1], b = s.nodes[k]
  s.segs[k] = 'C'
  s.cps[k] = { cp1x: r(a.x + (b.x - a.x) / 3), cp1y: r(a.y + (b.y - a.y) / 3), cp2x: r(a.x + 2 * (b.x - a.x) / 3), cp2y: r(a.y + 2 * (b.y - a.y) / 3) }
}

function insertNode(s, after, t) {
  if (!(t > 0 && t < 1)) throw new Error('t must be between 0 and 1')
  const { nodes, segs, cps } = s, n = nodes.length
  if (after === n - 1) {
    if (!s.closed) throw new Error('no segment after the last node of an open path')
    const a = nodes[n - 1], b = nodes[0]
    nodes.push({ x: r(a.x + (b.x - a.x) * t), y: r(a.y + (b.y - a.y) * t), locked: false })
    segs.push('L'); cps.push(null)
    return
  }
  const k = after + 1, p0 = nodes[after], p1 = nodes[k], cp = cps[k]
  if (segs[k] === 'C') {
    const L = (a, b) => a + (b - a) * t
    const ax = L(p0.x, cp.cp1x), ay = L(p0.y, cp.cp1y), bx = L(cp.cp1x, cp.cp2x), by = L(cp.cp1y, cp.cp2y)
    const cx = L(cp.cp2x, p1.x), cy = L(cp.cp2y, p1.y), dx = L(ax, bx), dy = L(ay, by), ex = L(bx, cx), ey = L(by, cy)
    const mx = L(dx, ex), my = L(dy, ey)
    cps[k] = { cp1x: r(ex), cp1y: r(ey), cp2x: r(cx), cp2y: r(cy) }
    nodes.splice(k, 0, { x: r(mx), y: r(my), locked: false })
    segs.splice(k, 0, 'C'); cps.splice(k, 0, { cp1x: r(ax), cp1y: r(ay), cp2x: r(dx), cp2y: r(dy) })
  } else {
    nodes.splice(k, 0, { x: r(p0.x + (p1.x - p0.x) * t), y: r(p0.y + (p1.y - p0.y) * t), locked: false })
    segs.splice(k, 0, 'L'); cps.splice(k, 0, null)
  }
}

// ── Whole-shape transforms ──────────────────────────────────────────────────
// m: matrix for paths. p: the same transform as parameters, for primitives.
function transformWhole(s, m, p) {
  if (s.type === 'path') {
    if (normalizePath(s)) mapNodePath(s, m)
    else s.d = serializeD(transformCmds(parseD(s.d), m))
    return
  }
  const [cx, cy] = s.type === 'ellipse' ? [s.cx, s.cy] : [s.x + s.w / 2, s.y + s.h / 2]
  let nx = cx, ny = cy
  if (p.dx != null || p.dy != null) { nx += p.dx || 0; ny += p.dy || 0 }
  if (p.sx != null) {
    nx = p.ox + (cx - p.ox) * p.sx; ny = p.oy + (cy - p.oy) * p.sy
    if (s.type === 'ellipse') { s.rx = r(s.rx * Math.abs(p.sx)); s.ry = r(s.ry * Math.abs(p.sy)) }
    else { s.w = r(s.w * Math.abs(p.sx)); s.h = r(s.h * Math.abs(p.sy)) }
    if (p.mirror && s.rotation) s.rotation = -s.rotation
  }
  if (p.deg != null) {
    const t = p.deg * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t)
    nx = p.ox + (cx - p.ox) * c - (cy - p.oy) * sn
    ny = p.oy + (cx - p.ox) * sn + (cy - p.oy) * c
    s.rotation = r(((s.rotation || 0) + p.deg) % 360)
    if (!s.rotation) delete s.rotation
  }
  if (s.type === 'ellipse') { s.cx = r(nx); s.cy = r(ny) }
  else { s.x = r(nx - s.w / 2); s.y = r(ny - s.h / 2) }
}

// Default pivot: centre of the shape's visible bounds
function origin(s, given) {
  if (Array.isArray(given) && given.length === 2) return [num(given[0]), num(given[1])]
  if (s.type === 'ellipse') return [s.cx, s.cy]
  if (s.type === 'rect') return [s.x + s.w / 2, s.y + s.h / 2]
  const smp = sampleShape(s)
  if (!smp || !smp.pts.length) throw new Error(`can't measure ${refOf(s)}; give an origin`)
  const xs = smp.pts.map(p => p.x), ys = smp.pts.map(p => p.y)
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

function addShape(work, op, alias, newId) {
  const sh = op.shape
  if (!sh || typeof sh !== 'object') throw new Error('add needs a "shape" object')
  const base = { stroke: sh.stroke || '#4ade80', fill: sh.fill ?? 'none', 'stroke-width': num(sh['stroke-width'], 1.5), opacity: num(sh.opacity, 1) }
  let s
  if (sh.type === 'ellipse') s = { type: 'ellipse', cx: r(num(sh.cx)), cy: r(num(sh.cy)), rx: r(num(sh.rx)), ry: r(num(sh.ry ?? sh.rx)), ...base }
  else if (sh.type === 'rect') s = { type: 'rect', x: r(num(sh.x)), y: r(num(sh.y)), w: r(num(sh.w)), h: r(num(sh.h)), ...base }
  else if (sh.type === 'path' && typeof sh.d === 'string') {
    parseD(sh.d)   // throws on malformed data
    s = { type: 'path', d: sh.d, ...base }
    normalizePath(s)
  } else throw new Error('shape.type must be ellipse, rect or path (with "d")')
  if (sh.label || op.name) s.label = String(sh.label || op.name).slice(0, 60)
  s.id = newId()
  work.push(s)
  if (op.as) alias[op.as] = s.id
  return s.id
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function resolve(work, t, alias) {
  if (t == null) throw new Error('missing "target"')
  let id = alias[t]
  if (id == null) {
    const m = /^s?(\d+)$/.exec(String(t).trim())
    if (!m) throw new Error(`unknown target "${t}"`)
    id = +m[1]
  }
  const s = work.find(x => x.id === id)
  if (!s) throw new Error(`no shape ${t}`)
  return s
}

function idx(v, n, name) {
  let i = Number(v)
  if (!Number.isInteger(i)) throw new Error(`"${name}" must be a node index`)
  if (i < 0) i += n
  if (i < 0 || i >= n) throw new Error(`${name} ${v} out of range (0–${n - 1})`)
  return i
}

function num(v, dflt) {
  if (v == null || v === '') { if (dflt !== undefined) return dflt; throw new Error('missing number') }
  const x = Number(v)
  if (!Number.isFinite(x)) throw new Error(`"${v}" is not a number`)
  return x
}

function refOf(s) { return 's' + s.id }

// One-line, human-readable rendering of an op for the review list
export function opText(op, nameOf = t => t) {
  const t = op && op.target != null ? nameOf(op.target) : ''
  const sg = v => (v > 0 ? '+' : '') + r(Number(v) || 0)
  switch (op && op.op) {
    case 'move':        return `move ${t} by (${sg(op.dx)}, ${sg(op.dy)})`
    case 'scale':       return `scale ${t} ×${op.sx}${op.sy != null && op.sy !== op.sx ? ` / ×${op.sy}` : ''}`
    case 'rotate':      return `rotate ${t} ${sg(op.deg)}°`
    case 'mirror':      return `flip ${t} ${op.axis === 'vertical' ? 'left↔right' : 'top↔bottom'}`
    case 'set_params':  return `set ${t} ` + ['cx', 'cy', 'rx', 'ry', 'x', 'y', 'w', 'h'].filter(k => op[k] != null).map(k => `${k}=${op[k]}`).join(' ')
    case 'set_style':   return `restyle ${t} ` + ['stroke', 'fill', 'stroke-width', 'opacity'].filter(k => op[k] != null).map(k => `${k} ${op[k]}`).join(', ')
    case 'label':       return `name ${t} “${op.name}”`
    case 'reorder':     return `send ${t} ${op.to}`
    case 'duplicate':   return `duplicate ${t}${op.dx || op.dy ? ` offset (${sg(op.dx)}, ${sg(op.dy)})` : ''}`
    case 'delete':      return `delete ${t}`
    case 'move_node':   return `${t} node ${op.node} by (${sg(op.dx)}, ${sg(op.dy)})`
    case 'set_node':    return `${t} node ${op.node} → (${op.x}, ${op.y})`
    case 'move_handle': return `${t} node ${op.node} ${op.handle}-handle by (${sg(op.dx)}, ${sg(op.dy)})`
    case 'set_handle':  return `${t} node ${op.node} ${op.handle}-handle → (${op.x}, ${op.y})`
    case 'smooth_node': return `smooth ${t} node ${op.node}`
    case 'set_segment': return `${t} segment → node ${op.node} ${op.seg === 'L' ? 'straight' : 'curved'}`
    case 'insert_node': return `${t} add node after ${op.after}`
    case 'delete_node': return `${t} remove node ${op.node}`
    case 'set_closed':  return `${op.closed ? 'close' : 'open'} ${t}`
    case 'add':         return `add ${op.shape && op.shape.type || 'shape'}${op.as ? ` (${op.as})` : ''}`
  }
  return JSON.stringify(op)
}

const base = new URL('../js/', import.meta.url).href
const { describeScene } = await import(base + 'describe.js')
const { applyOps, opText } = await import(base + 'ops.js')
const { parseD, cmdsToNodes } = await import(base + 'pathdata.js')
let fails = 0
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fails++; console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)) } }
const shapes = [
  { id: 1, type: 'ellipse', cx: 100, cy: 100, rx: 60, ry: 50, stroke: '#fff', fill: '#333', 'stroke-width': 2, opacity: 1, label: 'head' },
  { id: 2, type: 'ellipse', cx: 80, cy: 90, rx: 6, ry: 8, stroke: '#fff', fill: 'none', 'stroke-width': 1, opacity: 1 },
  { id: 3, type: 'ellipse', cx: 120, cy: 90, rx: 6, ry: 8, stroke: '#fff', fill: 'none', 'stroke-width': 1, opacity: 1 },
  { id: 4, type: 'path', d: 'M 70 50 L 60 20 L 90 45 Z', stroke: '#fff', fill: 'none', 'stroke-width': 1, opacity: 1 },
  { id: 5, type: 'path', d: 'M 10 10 h 20 v 20 Z M 40 40 a 5 5 0 1 0 10 0', stroke: '#fff', fill: 'none', 'stroke-width': 1, opacity: 1 },
  { id: 6, type: 'path', nodes: [{x:60,y:120,locked:false},{x:100,y:135,locked:true},{x:140,y:120,locked:false}], segs:[null,'Q','L'], cps:[null,{cx:80,cy:135},null], closed:false, stroke:'#fff', fill:'none','stroke-width':1, opacity:1 },
]
const sc = describeScene(shapes, [], { selectedIds: [2] })

const s4 = sc.shapes.find(s => s.ref === 's4'); eq(s4.editable, 'nodes', 's4 editable'); eq(s4.nodes.length, 3, 's4 3 nodes (closing L dropped? no explicit L back)')
eq(sc.shapes.find(s => s.ref === 's5').editable, 'whole', 'compound')
eq(sc.shapes.find(s => s.ref === 's6').nodes[1].in != null, true, 'Q became C handle')
eq(sc.relations.some(x => x.rel === 'mirrors' && x.a === 's2' && x.b === 's3'), true, 'eyes mirror')
eq(sc.relations.some(x => x.rel === 'contains' && x.a === 's1' && x.b === 's2'), true, 'head contains eye')
eq(sc.shapes[0].symmetric, ['vertical', 'horizontal'], 'ellipse symmetric')

const ops = [
  { op: 'move', target: 's2', dx: -2, dy: 0 },
  { op: 'move_node', target: 's4', node: 1, dx: 0, dy: -5 },
  { op: 'move_node', target: 's6', node: 1, dx: 0, dy: 1 },   // locked node
  { op: 'set_params', target: 's3', rx: 7 },
  { op: 'move', target: 's5', dx: 5, dy: 5 },
  { op: 'add', as: 'n1', shape: { type: 'ellipse', cx: 100, cy: 110, rx: 3, ry: 2 } },
  { op: 'move', target: 'n1', dx: 0, dy: 2 },
  { op: 'mirror', target: 's4', axis: 'vertical', at: 100 },
  { op: 'insert_node', target: 's6', after: 0 },
  { op: 'smooth_node', target: 's6', node: 1 },
  { op: 'scale', target: 's1', sx: 1.1 },
  { op: 'rotate', target: 's2', deg: 90 },
  { op: 'bogus', target: 's1' },
  { op: 'delete', target: 's99' },
]
const res = applyOps(shapes, ops, { nextId: 7 })
res.results.forEach((x, i) => console.log(x.ok ? 'ok ' : 'ERR', opText(ops[i]), x.error || ''))
const by = id => res.shapes.find(s => s.id === id)
eq(by(2).cx, 78, 'eye moved'); eq(by(3).rx, 7, 'rx set')
eq(by(4).nodes.map(n => [n.x, n.y]), [[130,50],[140,15],[110,45]], 'move_node then mirror')
eq(by(5).d, 'M 15 15 L 35 15 L 35 35 Z M 45 45 A 5 5 0 1 0 55 45', 'compound translated')
eq(by(7).cy, 112, 'alias add+move'); eq(by(1).rx, 66, 'scale')
eq(res.results[2].ok, false, 'locked node refused'); eq(res.results[12].ok, false, 'unknown op'); eq(res.results[13].ok, false, 'missing shape')
eq(shapes[1].cx, 80, 'input not mutated')
eq(by(6).nodes.length, 4, 'inserted node')
eq(by(2).rotation, 90, 'ellipse rotation')
console.log(fails ? `${fails} FAILURES` : 'ALL PASS'); process.exit(fails ? 1 : 0)

import { r } from './math.js'

export function aiStyle(p) {
  let stroke = '#4ade80', sw = 1.5, fill = 'none', scale = 1
  if (/\bred\b/.test(p))     stroke = '#f87171'
  if (/\bblue\b/.test(p))    stroke = '#60a5fa'
  if (/purple/.test(p))      stroke = '#c084fc'
  if (/yellow/.test(p))      stroke = '#facc15'
  if (/pink/.test(p))        stroke = '#f472b6'
  if (/white/.test(p))       stroke = '#e4e4e7'
  if (/orange/.test(p))      stroke = '#fb923c'
  if (/fill|solid|filled/.test(p)) fill = stroke
  if (/small|tiny/.test(p))  scale = 0.6
  if (/big|large|huge/.test(p)) scale = 1.5
  return { stroke, fill, sw, scale }
}

// Smooth Catmull-Rom path from [[x,y],...] points
export function aiPath(pts, closed, stroke, fill, sw) {
  const nodes = pts.map(([x, y]) => ({ x: r(x), y: r(y), locked: false }))
  const n = nodes.length, segs = [null], cpsArr = [null], t = 0.4
  for (let i = 1; i < n; i++) {
    const p0 = nodes[Math.max(0,i-2)], p1 = nodes[i-1], p2 = nodes[i], p3 = nodes[Math.min(n-1,i+1)]
    segs.push('C')
    cpsArr.push({ cp1x:r(p1.x+(p2.x-p0.x)*t/3), cp1y:r(p1.y+(p2.y-p0.y)*t/3),
                  cp2x:r(p2.x-(p3.x-p1.x)*t/3), cp2y:r(p2.y-(p3.y-p1.y)*t/3) })
  }
  return { type:'path', nodes, segs, cps:cpsArr, closed:!!closed, stroke, fill, 'stroke-width':sw, opacity:1 }
}

// Straight-segment path from [[x,y],...] points
export function aiLPath(pts, closed, stroke, fill, sw) {
  const nodes = pts.map(([x, y]) => ({ x: r(x), y: r(y), locked: false }))
  const segs = [null], cpsArr = [null]
  for (let i = 1; i < nodes.length; i++) { segs.push('L'); cpsArr.push(null) }
  return { type:'path', nodes, segs, cps:cpsArr, closed:!!closed, stroke, fill, 'stroke-width':sw, opacity:1 }
}

export function aiCircle(sc, stroke, fill, sw) {
  const rv = r(40*sc)
  return [{ type:'ellipse', cx:100, cy:100, rx:rv, ry:rv, stroke, fill, 'stroke-width':sw, opacity:1 }]
}
export function aiSquare(sc, stroke, fill, sw) {
  const s = r(60*sc)
  return [{ type:'rect', x:r(100-s/2), y:r(100-s/2), w:s, h:s, stroke, fill, 'stroke-width':sw, opacity:1 }]
}
export function aiRect(sc, stroke, fill, sw) {
  const w=r(80*sc), h=r(50*sc)
  return [{ type:'rect', x:r(100-w/2), y:r(100-h/2), w, h, stroke, fill, 'stroke-width':sw, opacity:1 }]
}
export function aiTriangle(sc, stroke, fill, sw) {
  const s=50*sc
  return [aiLPath([[100,100-s],[100+s*0.866,100+s*0.5],[100-s*0.866,100+s*0.5]], true, stroke, fill, sw)]
}
export function aiStar(sc, stroke, fill, sw) {
  const pts=[]
  for (let i=0;i<10;i++) { const a=(i*Math.PI/5)-Math.PI/2, rv=i%2===0?45*sc:18*sc; pts.push([100+Math.cos(a)*rv,100+Math.sin(a)*rv]) }
  return [aiLPath(pts, true, stroke, fill, sw)]
}
export function aiHeart(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  return [aiPath([f(100,135),f(58,93),f(60,63),f(100,78),f(140,63),f(142,93)], true, stroke, fill, sw)]
}
export function aiArrow(p, sc, stroke, fill, sw) {
  const s=40*sc, t=14*sc
  let pts
  if (/left/.test(p))       pts=[[100+s,100-t],[100,100-t],[100,100-s*.55],[100-s,100],[100,100+s*.55],[100,100+t],[100+s,100+t]]
  else if (/up/.test(p))    pts=[[100-t,100+s],[100-t,100],[100-s*.55,100],[100,100-s],[100+s*.55,100],[100+t,100],[100+t,100+s]]
  else if (/down/.test(p))  pts=[[100-t,100-s],[100-t,100],[100-s*.55,100],[100,100+s],[100+s*.55,100],[100+t,100],[100+t,100-s]]
  else                      pts=[[100-s,100-t],[100,100-t],[100,100-s*.55],[100+s,100],[100,100+s*.55],[100,100+t],[100-s,100+t]]
  return [aiLPath(pts, true, stroke, fill, sw)]
}
export function aiWave(sc, stroke, fill, sw) {
  const pts=[]
  for (let i=0;i<=10;i++) pts.push([15+i*17, 100+Math.sin(i*Math.PI/2.5)*30*sc])
  return [aiPath(pts, false, stroke, fill, sw)]
}
export function aiSpiral(sc, stroke, fill, sw) {
  const pts=[]
  for (let i=0;i<=60;i++) { const a=(i/60)*3*Math.PI, rv=(i/60)*48*sc; pts.push([100+Math.cos(a)*rv,100+Math.sin(a)*rv]) }
  return [aiPath(pts, false, stroke, fill, sw)]
}
export function aiDiamond(sc, stroke, fill, sw) {
  const s=48*sc
  return [aiLPath([[100,100-s],[100+s*.65,100],[100,100+s],[100-s*.65,100]], true, stroke, fill, sw)]
}
export function aiHexagon(sc, stroke, fill, sw) {
  const pts=[]
  for (let i=0;i<6;i++) { const a=i*Math.PI/3-Math.PI/6; pts.push([100+Math.cos(a)*45*sc,100+Math.sin(a)*45*sc]) }
  return [aiLPath(pts, true, stroke, fill, sw)]
}
export function aiCross(sc, stroke, fill, sw) {
  const s=38*sc, t=13*sc
  return [aiLPath([[100-t,100-s],[100+t,100-s],[100+t,100-t],[100+s,100-t],[100+s,100+t],[100+t,100+t],[100+t,100+s],[100-t,100+s],[100-t,100+t],[100-s,100+t],[100-s,100-t],[100-t,100-t]], true, stroke, fill, sw)]
}
export function aiMoon(sc, stroke, fill, sw) {
  const R=42*sc, off=14*sc, Ri=36*sc, pts=[]
  for (let i=0;i<=12;i++) { const a=-1.8+(i/12)*3.6; pts.push([100+Math.cos(a)*R,100+Math.sin(a)*R]) }
  for (let i=12;i>=0;i--) { const a=-1.8+(i/12)*3.6; pts.push([100+off+Math.cos(a)*Ri,100+Math.sin(a)*Ri]) }
  return [aiPath(pts, true, stroke, fill, sw)]
}
export function aiMountain(sc, stroke, fill, sw) {
  const base=[[10,175],[50,90],[80,130],[100,55],[125,115],[158,72],[190,175]]
  return [aiLPath(base.map(([x,y])=>[x, 100+(y-115)*sc]), false, stroke, fill, sw)]
}
export function aiSun(sc, stroke, fill, sw) {
  const res=[{ type:'ellipse', cx:100, cy:100, rx:r(24*sc), ry:r(24*sc), stroke, fill, 'stroke-width':sw, opacity:1 }]
  for (let i=0;i<8;i++) {
    const ang=i*Math.PI/4, r1v=r(32*sc), r2v=r(52*sc)
    res.push(aiLPath([[100+Math.cos(ang)*r1v,100+Math.sin(ang)*r1v],[100+Math.cos(ang)*r2v,100+Math.sin(ang)*r2v]], false, stroke, stroke, sw))
  }
  return res
}
export function aiLine(sc, stroke, sw) {
  return [aiLPath([[20,100],[180,100]], false, stroke, 'none', sw)]
}
export function aiCloud(sc, stroke, fill, sw) {
  // Cloud: overlapping arcs approximated as a smooth closed path
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  return [aiPath([f(60,110),f(42,100),f(45,80),f(65,75),f(72,60),f(92,58),f(108,65),f(128,60),f(145,70),f(148,88),f(132,100),f(110,108)], true, stroke, fill, sw)]
}
export function aiLightning(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  return [aiLPath([f(108,52),f(88,98),f(102,98),f(88,148),f(116,90),f(100,90)], true, stroke, fill, sw)]
}
export function aiLeaf(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const pts=[f(100,55),f(140,75),f(145,100),f(130,125),f(100,140),f(70,125),f(55,100),f(60,75)]
  const res=[aiPath(pts, true, stroke, fill, sw)]
  // stem
  res.push(aiLPath([f(100,140),f(100,158)], false, stroke, fill, sw))
  return res
}
export function aiFlower(sc, stroke, fill, sw) {
  const res=[]
  // center
  const rv=r(14*sc)
  res.push({ type:'ellipse', cx:100, cy:100, rx:rv, ry:rv, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  // 6 petals
  for (let i=0;i<6;i++) {
    const a=i*Math.PI/3, r1=22*sc, r2=42*sc
    const mx=100+Math.cos(a)*(r1+r2)/2, my=100+Math.sin(a)*(r1+r2)/2
    const ox=-Math.sin(a)*12*sc, oy=Math.cos(a)*12*sc
    res.push(aiPath([[100+Math.cos(a)*r1,100+Math.sin(a)*r1],[mx+ox,my+oy],[100+Math.cos(a)*r2,100+Math.sin(a)*r2],[mx-ox,my-oy]], true, stroke, fill, sw))
  }
  return res
}
export function aiTree(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const res=[
    aiLPath([f(100,45),f(130,90),f(116,90),f(138,118),f(122,118),f(145,148),f(55,148),f(78,118),f(62,118),f(84,90),f(70,90)], true, stroke, fill, sw),
    aiLPath([f(93,148),f(93,162),f(107,162),f(107,148)], false, stroke, fill, sw),
  ]
  return res
}
export function aiHouse(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  return [
    aiLPath([f(60,145),f(60,100),f(100,65),f(140,100),f(140,145)], true, stroke, fill, sw),
    aiLPath([f(88,145),f(88,118),f(112,118),f(112,145)], false, stroke, fill, sw), // door
  ]
}
export function aiFish(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const res=[
    // body
    aiPath([f(70,100),f(80,82),f(110,80),f(138,88),f(148,100),f(138,112),f(110,120),f(80,118)], true, stroke, fill, sw),
    // tail
    aiLPath([f(70,100),f(42,80),f(55,100),f(42,120)], true, stroke, fill, sw),
    // eye
  ]
  const er=r(4*sc)
  res.push({ type:'ellipse', cx:r(124), cy:100, rx:er, ry:er, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  return res
}
export function aiTadpole(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const res=[]
  // Big round head (left side)
  const hr=r(24*sc)
  res.push({ type:'ellipse', cx:r(100-20*sc), cy:100, rx:hr, ry:hr, stroke, fill, 'stroke-width':sw, opacity:1 })
  // Tapered tail outline (teardrop pointing right)
  res.push(aiPath([f(104,94),f(132,87),f(158,93),f(170,100),f(158,107),f(132,113),f(104,106)], true, stroke, fill, sw))
  // Eye
  const er=r(4*sc)
  res.push({ type:'ellipse', cx:r(100-14*sc), cy:r(100-8*sc), rx:er, ry:er, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  return res
}
export function aiFrog(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const res=[]
  // Body (wide oval)
  res.push({ type:'ellipse', cx:100, cy:r(100+14*sc), rx:r(30*sc), ry:r(22*sc), stroke, fill, 'stroke-width':sw, opacity:1 })
  // Head
  const hr=r(16*sc)
  res.push({ type:'ellipse', cx:100, cy:r(100-18*sc), rx:hr, ry:hr, stroke, fill, 'stroke-width':sw, opacity:1 })
  // Eyes (bulging)
  const er=r(9*sc)
  res.push({ type:'ellipse', cx:r(100-14*sc), cy:r(100-30*sc), rx:er, ry:er, stroke, fill, 'stroke-width':sw, opacity:1 })
  res.push({ type:'ellipse', cx:r(100+14*sc), cy:r(100-30*sc), rx:er, ry:er, stroke, fill, 'stroke-width':sw, opacity:1 })
  // Pupils
  const pr=r(4*sc)
  res.push({ type:'ellipse', cx:r(100-14*sc), cy:r(100-30*sc), rx:pr, ry:pr, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  res.push({ type:'ellipse', cx:r(100+14*sc), cy:r(100-30*sc), rx:pr, ry:pr, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  // Mouth (small smile)
  res.push(aiPath([f(92,92),f(100,97),f(108,92)], false, stroke, fill, sw))
  // Front legs
  res.push(aiPath([f(72,102),f(60,112),f(52,122),f(48,132)], false, stroke, fill, sw))
  res.push(aiPath([f(128,102),f(140,112),f(148,122),f(152,132)], false, stroke, fill, sw))
  // Back legs (bent, classic frog pose)
  res.push(aiPath([f(80,124),f(58,136),f(46,150),f(54,158),f(70,150)], false, stroke, fill, sw))
  res.push(aiPath([f(120,124),f(142,136),f(154,150),f(146,158),f(130,150)], false, stroke, fill, sw))
  return res
}
export function aiCat(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const res=[]
  // Head
  res.push({ type:'ellipse', cx:100, cy:r(100-8*sc), rx:r(22*sc), ry:r(20*sc), stroke, fill, 'stroke-width':sw, opacity:1 })
  // Ears (pointy triangles)
  res.push(aiLPath([f(78,76),f(72,54),f(92,72)], true, stroke, fill, sw))
  res.push(aiLPath([f(122,76),f(128,54),f(108,72)], true, stroke, fill, sw))
  // Eyes (filled dots)
  const er=r(4*sc)
  res.push({ type:'ellipse', cx:r(100-10*sc), cy:r(100-10*sc), rx:er, ry:er, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  res.push({ type:'ellipse', cx:r(100+10*sc), cy:r(100-10*sc), rx:er, ry:er, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  // Nose (tiny dot)
  const nr=r(2.5*sc)
  res.push({ type:'ellipse', cx:100, cy:r(100-2*sc), rx:nr, ry:nr, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  // Whiskers
  res.push(aiLPath([f(66,92),f(82,94)], false, stroke, fill, sw))
  res.push(aiLPath([f(66,98),f(82,98)], false, stroke, fill, sw))
  res.push(aiLPath([f(134,92),f(118,94)], false, stroke, fill, sw))
  res.push(aiLPath([f(134,98),f(118,98)], false, stroke, fill, sw))
  // Body
  res.push({ type:'ellipse', cx:100, cy:r(100+28*sc), rx:r(18*sc), ry:r(26*sc), stroke, fill, 'stroke-width':sw, opacity:1 })
  // Tail (curving upward)
  res.push(aiPath([f(115,144),f(145,138),f(158,122),f(148,108),f(132,112)], false, stroke, fill, sw))
  return res
}
export function aiRabbit(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const res=[]
  // Ears (long thin ovals — drawn first so head overlaps base)
  res.push({ type:'ellipse', cx:r(100-13*sc), cy:r(100-42*sc), rx:r(7*sc), ry:r(22*sc), stroke, fill, 'stroke-width':sw, opacity:1 })
  res.push({ type:'ellipse', cx:r(100+13*sc), cy:r(100-42*sc), rx:r(7*sc), ry:r(22*sc), stroke, fill, 'stroke-width':sw, opacity:1 })
  // Head
  const hr=r(18*sc)
  res.push({ type:'ellipse', cx:100, cy:r(100-2*sc), rx:hr, ry:hr, stroke, fill, 'stroke-width':sw, opacity:1 })
  // Eyes
  const er=r(4*sc)
  res.push({ type:'ellipse', cx:r(100-9*sc), cy:r(100-8*sc), rx:er, ry:er, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  res.push({ type:'ellipse', cx:r(100+9*sc), cy:r(100-8*sc), rx:er, ry:er, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  // Nose (tiny)
  const nr=r(2.5*sc)
  res.push({ type:'ellipse', cx:100, cy:r(100+5*sc), rx:nr, ry:nr, stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  // Body
  res.push({ type:'ellipse', cx:100, cy:r(100+36*sc), rx:r(22*sc), ry:r(26*sc), stroke, fill, 'stroke-width':sw, opacity:1 })
  // Tail
  const tr=r(7*sc)
  res.push({ type:'ellipse', cx:r(100+24*sc), cy:r(100+36*sc), rx:tr, ry:tr, stroke, fill, 'stroke-width':sw, opacity:1 })
  return res
}
export function aiMushroom(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const res=[]
  // Cap (dome arch path)
  res.push(aiPath([f(62,100),f(64,76),f(76,60),f(100,54),f(124,60),f(136,76),f(138,100)], false, stroke, fill, sw))
  // Cap underside flat line
  res.push(aiLPath([f(62,100),f(138,100)], false, stroke, fill, sw))
  // Stem
  res.push(aiLPath([f(84,100),f(80,148),f(120,148),f(116,100)], true, stroke, fill, sw))
  // Spots on cap
  res.push({ type:'ellipse', cx:100, cy:r(100-30*sc), rx:r(5*sc), ry:r(5*sc), stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  res.push({ type:'ellipse', cx:r(100-18*sc), cy:r(100-18*sc), rx:r(4*sc), ry:r(4*sc), stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  res.push({ type:'ellipse', cx:r(100+18*sc), cy:r(100-18*sc), rx:r(4*sc), ry:r(4*sc), stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  return res
}
export function aiBird(sc, stroke, fill, sw) {
  // Simple bird silhouette in flight — two wing curves
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  return [
    aiPath([f(60,95),f(78,82),f(92,90),f(100,88),f(108,90),f(122,82),f(140,95)], false, stroke, fill, sw),
    aiPath([f(92,90),f(96,98),f(100,100),f(104,98),f(108,90)], false, stroke, fill, sw),
  ]
}
export function aiFlame(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  return [aiPath([f(100,52),f(122,72),f(130,95),f(118,115),f(108,105),f(116,88),f(100,72),f(84,88),f(92,105),f(82,115),f(70,95),f(78,72)], true, stroke, fill, sw)]
}
export function aiGear(sc, stroke, fill, sw) {
  const pts=[], teeth=8, inner=28*sc, outer=42*sc, tooth=8*sc
  for (let i=0;i<teeth*4;i++) {
    const a=(i/(teeth*4))*Math.PI*2
    const isOuter=(i%4===1||i%4===2)
    const rv=isOuter?outer+tooth:outer
    pts.push([100+Math.cos(a)*rv,100+Math.sin(a)*rv])
  }
  const res=[aiLPath(pts, true, stroke, fill, sw)]
  const ir=r(inner)
  res.push({ type:'ellipse', cx:100, cy:100, rx:ir, ry:ir, stroke, fill:'none', 'stroke-width':sw, opacity:1 })
  return res
}
export function aiAnchor(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const res=[
    aiLPath([f(100,58),f(100,148)], false, stroke, fill, sw),         // shaft
    aiLPath([f(78,70),f(122,70)], false, stroke, fill, sw),           // crossbar
    aiPath([f(68,148),f(55,135),f(55,122),f(68,118),f(100,148),f(132,118),f(145,122),f(145,135),f(132,148)], false, stroke, fill, sw), // flukes
  ]
  const hr=r(8*sc)
  res.push({ type:'ellipse', cx:100, cy:r(100+(-30)*sc+(-30)*sc+58*sc), rx:hr, ry:hr, stroke, fill:'none', 'stroke-width':sw, opacity:1 })
  return res
}
export function aiPerson(sc, stroke, fill, sw) {
  const f=(x,y)=>[100+(x-100)*sc, 100+(y-100)*sc]
  const hr=r(10*sc)
  const res=[
    { type:'ellipse', cx:100, cy:r(100+(-35)*sc), rx:hr, ry:hr, stroke, fill:'none', 'stroke-width':sw, opacity:1 }, // head
    aiLPath([f(100,75),f(100,120)], false, stroke, fill, sw),         // torso
    aiLPath([f(75,95),f(100,85),f(125,95)], false, stroke, fill, sw), // arms
    aiLPath([f(100,120),f(80,148)], false, stroke, fill, sw),         // left leg
    aiLPath([f(100,120),f(120,148)], false, stroke, fill, sw),        // right leg
  ]
  return res
}
export function aiSnake(sc, stroke, fill, sw) {
  const pts=[]
  for (let i=0;i<=18;i++) {
    const t=i/18, x=20+t*160, amp=30*sc*Math.exp(-t*0.5)
    pts.push([x, 100+Math.sin(i*Math.PI*0.8)*amp])
  }
  const res=[aiPath(pts, false, stroke, fill, sw)]
  const last=pts[pts.length-1]
  const er=r(5*sc)
  res.push({ type:'ellipse', cx:r(last[0]), cy:r(last[1]), rx:er, ry:r(3*sc), stroke, fill:stroke, 'stroke-width':sw, opacity:1 })
  return res
}

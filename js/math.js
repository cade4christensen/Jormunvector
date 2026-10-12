// Pure geometry helpers — no DOM, no state

export function snap(n) { return Math.round(n * 10) / 10 }
export function r(n)    { return Math.round(n * 10) / 10 }
export function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) }

export function rdpSimplify(pts, epsilon) {
  if (pts.length <= 2) return pts
  let maxDist = 0, maxIdx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  if (maxDist > epsilon) {
    const left  = rdpSimplify(pts.slice(0, maxIdx + 1), epsilon)
    const right = rdpSimplify(pts.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [pts[0], pts[pts.length - 1]]
}

export function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return dist(p, a)
  return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / len
}

export function cubicB(p0, p1, p2, p3, t) {
  const m = 1 - t
  return m*m*m*p0 + 3*m*m*t*p1 + 3*m*t*t*p2 + t*t*t*p3
}

export function quadB(p0, p1, p2, t) {
  const m = 1 - t
  return m*m*p0 + 2*m*t*p1 + t*t*p2
}

export function computeNormals(pts) {
  return pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    let tx = next.x - prev.x, ty = next.y - prev.y
    const len = Math.sqrt(tx * tx + ty * ty) || 1
    return { nx: -ty / len, ny: tx / len }
  })
}


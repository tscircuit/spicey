import { EPS } from "../constants/EPS"

function pwlValue(pairs: { t: number; v: number }[], t: number): number {
  if (pairs.length === 0) return 0
  if (t <= pairs[0]!.t) return pairs[0]!.v
  for (let i = 1; i < pairs.length; i++) {
    const prev = pairs[i - 1]!
    const curr = pairs[i]!
    if (t <= curr.t) {
      const dt = Math.max(curr.t - prev.t, EPS)
      const a = (t - prev.t) / dt
      return prev.v + (curr.v - prev.v) * a
    }
  }
  return pairs[pairs.length - 1]!.v
}

export { pwlValue }

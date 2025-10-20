import { EPS } from "../constants/EPS"
import type { PulseSpec } from "../types/simulation"

function pulseValue(p: PulseSpec, t: number) {
  if (t < p.td) return p.v1
  const tt = t - p.td
  const cyclesDone = Math.floor(tt / p.period)
  if (cyclesDone >= p.ncycles) return p.v1
  const tc = tt - cyclesDone * p.period
  if (tc < p.tr) {
    const a = tc / Math.max(p.tr, EPS)
    return p.v1 + (p.v2 - p.v1) * a
  }
  if (tc < p.tr + p.ton) {
    return p.v2
  }
  if (tc < p.tr + p.ton + p.tf) {
    const a = (tc - (p.tr + p.ton)) / Math.max(p.tf, EPS)
    return p.v2 + (p.v1 - p.v2) * a
  }
  return p.v1
}

export { pulseValue }

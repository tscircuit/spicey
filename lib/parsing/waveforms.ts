import { EPS } from "../constants/EPS"
import { parseNumberWithUnits } from "./units"

type PulseSpec = {
  v1: number
  v2: number
  td: number
  tr: number
  tf: number
  ton: number
  period: number
  ncycles: number
}

function parsePulseArgs(token: string): PulseSpec {
  const clean = token.trim().replace(/^pulse\s*\(/i, "(")
  const inside = clean.replace(/^\(/, "").replace(/\)$/, "").trim()
  const parts = inside.split(/[\s,]+/).filter((x) => x.length)
  if (parts.length < 7) throw new Error("PULSE(...) requires 7 or 8 args")
  const vals = parts.map((value) => parseNumberWithUnits(value))
  if (vals.some((v) => Number.isNaN(v)))
    throw new Error("Invalid PULSE() numeric value")
  return {
    v1: vals[0]!,
    v2: vals[1]!,
    td: vals[2]!,
    tr: vals[3]!,
    tf: vals[4]!,
    ton: vals[5]!,
    period: vals[6]!,
    ncycles: parts[7] != null ? vals[7]! : Infinity,
  }
}

function parsePwlArgs(token: string) {
  const clean = token.trim().replace(/^pwl\s*\(/i, "(")
  const inside = clean.replace(/^\(/, "").replace(/\)$/, "").trim()
  const parts = inside.split(/[\s,]+/).filter((x) => x.length)
  if (parts.length === 0 || parts.length % 2 !== 0)
    throw new Error("PWL(...) requires an even number of time/value pairs")
  const pairs: { t: number; v: number }[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const t = parseNumberWithUnits(parts[i]!)
    const v = parseNumberWithUnits(parts[i + 1]!)
    if (Number.isNaN(t) || Number.isNaN(v))
      throw new Error("Invalid PWL() numeric value")
    pairs.push({ t, v })
  }
  return pairs
}

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

export { parsePulseArgs, parsePwlArgs, pwlValue, pulseValue }

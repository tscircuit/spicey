import type { PulseSpec } from "../types/simulation"
import { parseNumberWithUnits } from "./parseNumberWithUnits"

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

export { parsePulseArgs }

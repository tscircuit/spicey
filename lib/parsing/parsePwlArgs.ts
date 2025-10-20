import { parseNumberWithUnits } from "./parseNumberWithUnits"

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

export { parsePwlArgs }

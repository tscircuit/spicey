function parseNumberWithUnits(raw: unknown) {
  if (raw == null) return NaN
  let s = String(raw).trim()
  if (s === "") return NaN
  if (/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(s)) return parseFloat(s)
  const unitMul = {
    t: 1e12,
    g: 1e9,
    meg: 1e6,
    k: 1e3,
    m: 1e-3,
    u: 1e-6,
    n: 1e-9,
    p: 1e-12,
    f: 1e-15,
  } as const
  const m = s.match(/^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)([a-zA-Z]+)$/)
  if (!m) return parseFloat(s)
  const [, numberPart, suffixPart] = m
  if (numberPart == null) return parseFloat(s)
  let val = parseFloat(numberPart)
  let suf = (suffixPart ?? "").toLowerCase()
  suf = suf.replace(/(ohm|v|a|s|h|f)$/g, "")
  if (suf === "meg") return val * unitMul.meg
  if (suf.length === 1 && suf in unitMul) {
    const key = suf as keyof typeof unitMul
    return val * unitMul[key]
  }
  return val
}

export { parseNumberWithUnits }

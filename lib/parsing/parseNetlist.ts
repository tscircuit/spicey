import { EPS } from "../constants/EPS"

type Waveform = ((t: number) => number) | null

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

type ParsedResistor = { name: string; n1: number; n2: number; R: number }
type ParsedCapacitor = {
  name: string
  n1: number
  n2: number
  C: number
  vPrev: number
}
type ParsedInductor = {
  name: string
  n1: number
  n2: number
  L: number
  iPrev: number
}
type ParsedVoltageSource = {
  name: string
  n1: number
  n2: number
  dc: number
  acMag: number
  acPhaseDeg: number
  waveform: Waveform
  index: number
}

type ParsedACAnalysis = {
  mode: "dec" | "lin"
  N: number
  f1: number
  f2: number
} | null

type ParsedTranAnalysis = {
  dt: number
  tstop: number
} | null

type ParsedCircuit = {
  nodes: CircuitNodeIndex
  R: ParsedResistor[]
  C: ParsedCapacitor[]
  L: ParsedInductor[]
  V: ParsedVoltageSource[]
  analyses: {
    ac: ParsedACAnalysis
    tran: ParsedTranAnalysis
  }
  skipped: string[]
}

class NodeIndex {
  private map: Map<string, number>
  rev: string[]

  constructor() {
    this.map = new Map([["0", 0]])
    this.rev = ["0"]
  }

  getOrCreate(name: string) {
    const key = String(name)
    if (this.map.has(key)) return this.map.get(key) as number
    const idx = this.rev.length
    this.map.set(key, idx)
    this.rev.push(key)
    return idx
  }

  get(name: string) {
    return this.map.get(String(name))
  }

  count() {
    return this.rev.length
  }

  matrixIndexOfNode(nodeId: number) {
    if (nodeId === 0) return -1
    return nodeId - 1
  }
}

type CircuitNodeIndex = NodeIndex

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

function smartTokens(line: string) {
  const re = /"[^"]*"|\w+\s*\([^)]*\)|\([^()]*\)|\S+/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) out.push(m[0])
  return out
}

function requireToken(tokens: string[], index: number, context: string) {
  const token = tokens[index]
  if (token == null) throw new Error(context)
  return token
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

function parseNetlist(text: string): ParsedCircuit {
  const ckt: ParsedCircuit = {
    nodes: new NodeIndex(),
    R: [],
    C: [],
    L: [],
    V: [],
    analyses: { ac: null, tran: null },
    skipped: [],
  }

  const lines = text.split(/\r?\n/)
  let seenTitle = false

  for (const raw of lines) {
    let line = raw.trim()
    if (!line) continue
    if (/^\*/.test(line)) continue
    if (/^\s*\.end\b/i.test(line)) break
    line = line.replace(/\/\/.*$/, "")
    line = line.replace(/;.*$/, "")

    const tokens = smartTokens(line)
    if (tokens.length === 0) continue

    const first = tokens[0]!
    if (first.length === 0) continue

    if (!seenTitle && !/^[rclvgmiqd]\w*$/i.test(first) && !/^\./.test(first)) {
      seenTitle = true
      continue
    }

    if (/^\./.test(first)) {
      const dir = first.toLowerCase()
      if (dir === ".ac") {
        const mode = requireToken(tokens, 1, ".ac missing mode").toLowerCase()
        if (mode !== "dec" && mode !== "lin")
          throw new Error(".ac supports 'dec' or 'lin'")
        const N = parseInt(
          requireToken(tokens, 2, ".ac missing point count"),
          10,
        )
        const f1 = parseNumberWithUnits(
          requireToken(tokens, 3, ".ac missing start frequency"),
        )
        const f2 = parseNumberWithUnits(
          requireToken(tokens, 4, ".ac missing stop frequency"),
        )
        ckt.analyses.ac = { mode, N, f1, f2 }
      } else if (dir === ".tran") {
        const dt = parseNumberWithUnits(
          requireToken(tokens, 1, ".tran missing timestep"),
        )
        const tstop = parseNumberWithUnits(
          requireToken(tokens, 2, ".tran missing stop time"),
        )
        ckt.analyses.tran = { dt, tstop }
      } else {
        ckt.skipped.push(line)
      }
      continue
    }

    const typeChar = first.charAt(0).toLowerCase()
    const name = first

    try {
      if (typeChar === "r") {
        const n1 = ckt.nodes.getOrCreate(
          requireToken(tokens, 1, "Resistor missing node"),
        )
        const n2 = ckt.nodes.getOrCreate(
          requireToken(tokens, 2, "Resistor missing node"),
        )
        const val = parseNumberWithUnits(
          requireToken(tokens, 3, "Resistor missing value"),
        )
        ckt.R.push({ name, n1, n2, R: val })
      } else if (typeChar === "c") {
        const n1 = ckt.nodes.getOrCreate(
          requireToken(tokens, 1, "Capacitor missing node"),
        )
        const n2 = ckt.nodes.getOrCreate(
          requireToken(tokens, 2, "Capacitor missing node"),
        )
        const val = parseNumberWithUnits(
          requireToken(tokens, 3, "Capacitor missing value"),
        )
        ckt.C.push({ name, n1, n2, C: val, vPrev: 0 })
      } else if (typeChar === "l") {
        const n1 = ckt.nodes.getOrCreate(
          requireToken(tokens, 1, "Inductor missing node"),
        )
        const n2 = ckt.nodes.getOrCreate(
          requireToken(tokens, 2, "Inductor missing node"),
        )
        const val = parseNumberWithUnits(
          requireToken(tokens, 3, "Inductor missing value"),
        )
        ckt.L.push({ name, n1, n2, L: val, iPrev: 0 })
      } else if (typeChar === "v") {
        const n1 = ckt.nodes.getOrCreate(
          requireToken(tokens, 1, "Voltage source missing node"),
        )
        const n2 = ckt.nodes.getOrCreate(
          requireToken(tokens, 2, "Voltage source missing node"),
        )
        const spec: Omit<
          ParsedVoltageSource,
          "name" | "n1" | "n2" | "index"
        > & { index?: number } = {
          dc: 0,
          acMag: 0,
          acPhaseDeg: 0,
          waveform: null,
          index: -1,
        }
        let i = 3
        if (i < tokens.length && !/^[a-zA-Z]/.test(tokens[i]!)) {
          spec.dc = parseNumberWithUnits(tokens[i]!)
          i++
        }
        while (i < tokens.length) {
          const key = tokens[i]!.toLowerCase()
          if (key === "dc") {
            const valueToken = requireToken(tokens, i + 1, "DC value missing")
            spec.dc = parseNumberWithUnits(valueToken)
            i += 2
          } else if (key === "ac") {
            const magToken = requireToken(tokens, i + 1, "AC magnitude missing")
            spec.acMag = parseNumberWithUnits(magToken)
            const phaseToken = tokens[i + 2]
            if (phaseToken != null && /^[+-]?\d/.test(phaseToken)) {
              spec.acPhaseDeg = parseNumberWithUnits(phaseToken)
              i += 3
            } else {
              i += 2
            }
          } else if (key.startsWith("pulse")) {
            const argToken = key.includes("(")
              ? key
              : requireToken(tokens, i + 1, "PULSE() missing arguments")
            if (!argToken || !/\(.*\)/.test(argToken))
              throw new Error("Malformed PULSE() specification")
            const p = parsePulseArgs(argToken)
            spec.waveform = (t: number) => pulseValue(p, t)
            i += key.includes("(") ? 1 : 2
          } else if (/^\(.*\)$/.test(key)) {
            i++
          } else {
            i++
          }
        }
        ckt.V.push({
          name,
          n1,
          n2,
          dc: spec.dc,
          acMag: spec.acMag,
          acPhaseDeg: spec.acPhaseDeg,
          waveform: spec.waveform,
          index: spec.index ?? -1,
        })
      } else {
        ckt.skipped.push(line)
      }
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(`Parse error on line: "${line}"\n${err.message}`)
      }
      throw err
    }
  }

  const nNodes = ckt.nodes.count() - 1
  for (let i = 0; i < ckt.V.length; i++) {
    const vs = ckt.V[i]
    if (!vs) continue
    vs.index = nNodes + i
  }
  return ckt
}

export type {
  ParsedCircuit,
  ParsedACAnalysis,
  ParsedTranAnalysis,
  ParsedResistor,
  ParsedCapacitor,
  ParsedInductor,
  ParsedVoltageSource,
  CircuitNodeIndex,
}
export { parseNetlist }

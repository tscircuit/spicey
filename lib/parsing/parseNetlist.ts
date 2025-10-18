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

type ParsedDiodeModel = {
  name: string
  Is: number
  N: number
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

type ParsedVSwitchModel = {
  name: string
  Ron: number
  Roff: number
  Von: number
  Voff: number
}

type ParsedDiode = {
  name: string
  nPlus: number
  nMinus: number
  modelName: string
  model: ParsedDiodeModel | null
  vdPrev: number
}

type ParsedSwitch = {
  name: string
  n1: number
  n2: number
  ncPos: number
  ncNeg: number
  modelName: string
  model: ParsedVSwitchModel | null
  isOn: boolean
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
  S: ParsedSwitch[]
  D: ParsedDiode[]
  analyses: {
    ac: ParsedACAnalysis
    tran: ParsedTranAnalysis
  }
  probes: {
    tran: string[]
  }
  skipped: string[]
  models: {
    vswitch: Map<string, ParsedVSwitchModel>
    diode: Map<string, ParsedDiodeModel>
  }
}

class NodeIndex {
  private map: Map<string, number>
  rev: string[]

  constructor() {
    this.map = new Map([["0", 0]])
    this.rev = ["0"]
  }

  getOrCreate(name: string) {
    const origName = String(name)
    const key = origName.toUpperCase()
    if (this.map.has(key)) return this.map.get(key) as number
    const idx = this.rev.length
    this.map.set(key, idx)
    this.rev.push(origName)
    return idx
  }

  get(name: string) {
    return this.map.get(String(name).toUpperCase())
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

function parseNetlist(text: string): ParsedCircuit {
  const vswitchModels = new Map<string, ParsedVSwitchModel>()
  const diodeModels = new Map<string, ParsedDiodeModel>()

  const ckt: ParsedCircuit = {
    nodes: new NodeIndex(),
    R: [],
    C: [],
    L: [],
    V: [],
    S: [],
    D: [],
    analyses: { ac: null, tran: null },
    probes: { tran: [] },
    skipped: [],
    models: { vswitch: vswitchModels, diode: diodeModels },
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

    if (!seenTitle && !/^[rclvgsmiqd]\w*$/i.test(first) && !/^\./.test(first)) {
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
      } else if (dir === ".print") {
        const analysisType = requireToken(
          tokens,
          1,
          ".print missing analysis type",
        ).toLowerCase()
        if (analysisType === "tran") {
          const probeTokens = tokens.slice(2)
          for (const token of probeTokens) {
            const match = token.match(/^v\(([^)]+)\)$/i)
            if (match && match[1]) {
              const nodeName = match[1]
              if (
                !ckt.probes.tran.some(
                  (p) => p.toUpperCase() === nodeName.toUpperCase(),
                )
              ) {
                ckt.probes.tran.push(nodeName)
              }
            }
          }
        } else {
          ckt.skipped.push(line)
        }
      } else if (dir === ".model") {
        const nameToken = requireToken(tokens, 1, ".model missing name")
        const typeToken = requireToken(tokens, 2, ".model missing type")
        let type = typeToken
        let paramsStr = ""
        if (type.includes("(")) {
          const idx = type.indexOf("(")
          paramsStr = type.slice(idx + 1)
          type = type.slice(0, idx)
        }
        if (!paramsStr) {
          const rest = tokens.slice(3).join(" ")
          paramsStr = rest.replace(/^\(/, "").replace(/\)$/, "")
        } else {
          const rest = tokens.slice(3).join(" ").replace(/\)$/, "")
          paramsStr = `${paramsStr} ${rest}`.trim()
        }
        paramsStr = paramsStr.replace(/^\(/, "").replace(/\)$/, "").trim()
        const typeLower = type.toLowerCase()
        if (typeLower === "vswitch" || typeLower === "sw") {
          const model: ParsedVSwitchModel = {
            name: nameToken,
            Ron: 1,
            Roff: 1e12,
            Von: 0,
            Voff: 0,
          }
          let vt: number | undefined
          let vh: number | undefined
          if (paramsStr.length > 0) {
            const assignments = paramsStr.split(/[\s,]+/).filter(Boolean)
            for (const assignment of assignments) {
              const [keyRaw, valueRaw] = assignment.split("=")
              if (!keyRaw || valueRaw == null) continue
              const key = keyRaw.toLowerCase()
              const value = parseNumberWithUnits(valueRaw)
              if (Number.isNaN(value)) continue
              if (key === "ron") model.Ron = value
              else if (key === "roff") model.Roff = value
              else if (key === "von") model.Von = value
              else if (key === "voff") model.Voff = value
              else if (key === "vt") vt = value
              else if (key === "vh") vh = value
            }
          }
          if (vt !== undefined) {
            const Vh = vh ?? 0
            model.Von = vt + Vh / 2
            model.Voff = vt - Vh / 2
          }
          vswitchModels.set(nameToken.toLowerCase(), model)
        } else if (typeLower === "d") {
          const model: ParsedDiodeModel = {
            name: nameToken,
            Is: 1e-14, // default saturation current
            N: 1, // default ideality factor
          }
          if (paramsStr.length > 0) {
            const assignments = paramsStr.split(/[\s,]+/).filter(Boolean)
            for (const assignment of assignments) {
              const [keyRaw, valueRaw] = assignment.split("=")
              if (!keyRaw || valueRaw == null) continue
              const key = keyRaw.toLowerCase()
              const value = parseNumberWithUnits(valueRaw)
              if (Number.isNaN(value)) continue
              if (key === "is") model.Is = value
              else if (key === "n") model.N = value
            }
          }
          diodeModels.set(nameToken.toLowerCase(), model)
        } else {
          ckt.skipped.push(line)
        }
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
          } else if (key.startsWith("pwl")) {
            const argToken = key.includes("(")
              ? key
              : requireToken(tokens, i + 1, "PWL() missing arguments")
            if (!argToken || !/\(.*\)/.test(argToken))
              throw new Error("Malformed PWL() specification")
            const pairs = parsePwlArgs(argToken)
            spec.waveform = (t: number) => pwlValue(pairs, t)
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
      } else if (typeChar === "s") {
        const n1 = ckt.nodes.getOrCreate(
          requireToken(tokens, 1, "Switch missing node"),
        )
        const n2 = ckt.nodes.getOrCreate(
          requireToken(tokens, 2, "Switch missing node"),
        )
        const ncPos = ckt.nodes.getOrCreate(
          requireToken(tokens, 3, "Switch missing control node"),
        )
        const ncNeg = ckt.nodes.getOrCreate(
          requireToken(tokens, 4, "Switch missing control node"),
        )
        const modelName = requireToken(tokens, 5, "Switch missing model")
        ckt.S.push({
          name,
          n1,
          n2,
          ncPos,
          ncNeg,
          modelName: modelName.toLowerCase(),
          model: null,
          isOn: false,
        })
      } else if (typeChar === "d") {
        if (tokens.length === 4) {
          const nPlus = ckt.nodes.getOrCreate(
            requireToken(tokens, 1, "Diode missing node"),
          )
          const nMinus = ckt.nodes.getOrCreate(
            requireToken(tokens, 2, "Diode missing node"),
          )
          const modelName = requireToken(tokens, 3, "Diode missing model")
          ckt.D.push({
            name,
            nPlus,
            nMinus,
            modelName: modelName.toLowerCase(),
            model: null,
            vdPrev: 0,
          })
        } else {
          ckt.skipped.push(line)
        }
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

  for (const sw of ckt.S) {
    const model = vswitchModels.get(sw.modelName)
    if (!model)
      throw new Error(
        `Unknown .model ${sw.modelName} referenced by switch ${sw.name}`,
      )
    sw.model = model
    sw.isOn = false
  }

  for (const d of ckt.D) {
    const model = diodeModels.get(d.modelName)
    if (!model)
      throw new Error(
        `Unknown .model ${d.modelName} referenced by diode ${d.name}`,
      )
    d.model = model
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
  ParsedDiode,
  ParsedDiodeModel,
  ParsedVoltageSource,
  ParsedVSwitchModel,
  ParsedSwitch,
  CircuitNodeIndex,
}
export { parseNetlist }

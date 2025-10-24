import { EPS } from "../constants/EPS"
import type { PulseSpec } from "../types/simulation"
import { NodeIndex } from "./NodeIndex"
import { parseNumberWithUnits } from "./parseNumberWithUnits"
import { parsePulseArgs } from "./parsePulseArgs"
import { parsePwlArgs } from "./parsePwlArgs"
import { pulseValue } from "./pulseValue"
import { pwlValue } from "./pwlValue"

type Waveform = ((t: number) => number) | null

type ParsedResistor = { name: string; n1: number; n2: number; R: number }
type ParsedCapacitor = {
  name: string
  n1: number
  n2: number
  C: number
  vPrev: number
  iPrev: number
}
type ParsedInductor = {
  name: string
  n1: number
  n2: number
  L: number
  iPrev: number
  vPrev: number
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

type CircuitNodeIndex = NodeIndex

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
        ckt.C.push({ name, n1, n2, C: val, vPrev: 0, iPrev: 0 })
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
        ckt.L.push({ name, n1, n2, L: val, iPrev: 0, vPrev: 0 })
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

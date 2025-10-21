import { EPS } from "../constants/EPS"
import { VT_300K } from "../constants/physics"
import { solveReal } from "../math/solveReal"
import type { ParsedCircuit } from "../parsing/parseNetlist"
import { stampAdmittanceReal } from "../stamping/stampAdmittanceReal"
import { stampCurrentReal } from "../stamping/stampCurrentReal"
import { stampVoltageSourceReal } from "../stamping/stampVoltageSourceReal"

function pnJunctionVoltageLimit(
  vNew: number,
  vOld: number,
  vt: number,
  vcrit: number,
) {
  if (!Number.isFinite(vNew)) return vOld

  const dv = vNew - vOld
  if (vNew > vcrit && Math.abs(dv) > 2 * vt) {
    if (vOld > 0) {
      const arg = 1 + dv / vt
      if (arg > 0) vNew = vOld + vt * Math.log(arg)
      else vNew = vcrit
    } else {
      const arg = vNew / vt
      if (arg > 0) {
        vNew = vt * Math.log(arg)
        if (vNew > vcrit) vNew = vcrit
      } else {
        vNew = 0
      }
    }
  } else if (vNew < 0 && Math.abs(dv) > 2 * vt) {
    const arg = (vOld - vNew) / vt
    if (arg > 0) vNew = vOld - vt * Math.log(1 + arg)
    else vNew = 0
  }

  return vNew
}

const TIME_ROUND = 1e-12

function computeBaseTimeStep(
  ckt: ParsedCircuit,
  dtRequested: number,
  tstop: number,
) {
  const defaultDt =
    dtRequested > EPS ? dtRequested : Math.max(tstop / 1000, EPS)
  let dt = defaultDt
  const minDt = defaultDt / 1000

  for (const vs of ckt.V) {
    const meta = vs.waveformMeta
    if (!meta) continue
    if (meta.type === "pulse") {
      const ton = meta.spec.ton
      if (ton > EPS) {
        const candidate = ton / 10
        dt = Math.min(dt, Math.max(candidate, minDt))
      }
      const off = meta.spec.period - meta.spec.ton
      if (off > EPS) {
        const candidate = off / 10
        dt = Math.min(dt, Math.max(candidate, minDt))
      }
    } else if (meta.type === "pwl") {
      for (let i = 1; i < meta.pairs.length; i++) {
        const delta = Math.abs(meta.pairs[i]!.t - meta.pairs[i - 1]!.t)
        if (delta > EPS) {
          const candidate = delta / 5
          dt = Math.min(dt, Math.max(candidate, minDt))
        }
      }
    }
  }

  return Math.max(dt, EPS)
}

function buildTimePoints(ckt: ParsedCircuit, baseDt: number, tstop: number) {
  const addTime = (set: Set<number>, time: number) => {
    if (!Number.isFinite(time)) return
    if (time < 0 && time > -TIME_ROUND) time = 0
    if (time < 0 || time > tstop + TIME_ROUND) return
    const clamped = Math.min(Math.max(time, 0), tstop)
    set.add(Number(clamped.toFixed(12)))
  }

  const points = new Set<number>()
  addTime(points, 0)
  addTime(points, tstop)

  const steps = Math.max(1, Math.ceil(tstop / Math.max(baseDt, EPS)))
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(tstop, i * baseDt)
    addTime(points, t)
  }

  for (const vs of ckt.V) {
    const meta = vs.waveformMeta
    if (!meta) continue
    if (meta.type === "pulse") {
      const { spec } = meta
      const period = spec.period
      if (!Number.isFinite(period) || period <= EPS) continue
      const cyclesToCover = (() => {
        if (!Number.isFinite(spec.ncycles)) {
          const remaining = Math.max(tstop - spec.td, 0)
          return Math.max(0, Math.ceil(remaining / period) + 2)
        }
        return Math.max(0, Math.ceil(spec.ncycles))
      })()
      for (let cycle = 0; cycle < cyclesToCover; cycle++) {
        const base = spec.td + cycle * period
        if (base > tstop + TIME_ROUND) break
        addTime(points, base)
        const riseEnd = base + spec.tr
        addTime(points, riseEnd)
        const highEnd = riseEnd + spec.ton
        addTime(points, highEnd)
        const fallEnd = highEnd + spec.tf
        addTime(points, fallEnd)
      }
    } else if (meta.type === "pwl") {
      for (const pair of meta.pairs) {
        addTime(points, pair.t)
      }
    }
  }

  return Array.from(points).sort((a, b) => a - b)
}

/**
 * Stamps all elements (R, C, L, switches, voltage sources, diodes) into A and b
 * for the given time t and Newton iteration.
 */
function stampAllElementsAtTime(
  A: number[][],
  b: number[],
  ckt: ParsedCircuit,
  t: number,
  dt: number,
  x: number[],
  iter: number,
  diodeLinearization: number[],
) {
  // Resistors (conductance to ground and between nodes)
  for (const r of ckt.R) {
    const G = 1 / r.R
    stampAdmittanceReal(A, ckt.nodes, r.n1, r.n2, G)
  }

  // Capacitors via Thevenin companion: Gc and Ieq
  for (const c of ckt.C) {
    const Gc = c.C / Math.max(dt, EPS)
    stampAdmittanceReal(A, ckt.nodes, c.n1, c.n2, Gc)
    const Ieq = -Gc * c.vPrev
    stampCurrentReal(b, ckt.nodes, c.n1, c.n2, Ieq)
  }

  // Inductors via Norton companion: Gl and current source
  for (const l of ckt.L) {
    const Gl = Math.max(dt, EPS) / l.L
    stampAdmittanceReal(A, ckt.nodes, l.n1, l.n2, Gl)
    stampCurrentReal(b, ckt.nodes, l.n1, l.n2, l.iPrev)
  }

  // Voltage-controlled switches as conductances based on last state
  for (const sw of ckt.S) {
    const model = sw.model
    if (!model) continue
    const Rvalue = sw.isOn ? model.Ron : model.Roff
    const Rclamped = Math.max(Math.abs(Rvalue), EPS)
    const G = 1 / Rclamped
    stampAdmittanceReal(A, ckt.nodes, sw.n1, sw.n2, G)
  }

  // Independent voltage sources (DC or waveform)
  for (const vs of ckt.V) {
    const Vt = vs.waveform ? vs.waveform(t) : vs.dc || 0
    stampVoltageSourceReal(A, b, ckt.nodes, vs, Vt)
  }

  // Diodes (Shockley model) using companion linearization for Newton step
  for (let idx = 0; idx < ckt.D.length; idx++) {
    const d = ckt.D[idx]
    if (!d) continue
    const model = d.model
    if (!model) continue

    const { nPlus, nMinus } = d

    const vp_idx = ckt.nodes.matrixIndexOfNode(nPlus)
    const vn_idx = ckt.nodes.matrixIndexOfNode(nMinus)

    const v_plus_prev_iter = nPlus === 0 ? 0 : (x[vp_idx] ?? 0)
    const v_minus_prev_iter = nMinus === 0 ? 0 : (x[vn_idx] ?? 0)
    const vd_prev_iter = v_plus_prev_iter - v_minus_prev_iter

    const vt = Math.max(model.N * VT_300K, 1e-6)
    const isat = Math.max(model.Is, 1e-18)
    const vcrit = vt * Math.log(Math.max(vt / (isat * Math.SQRT2), 1 + EPS))

    const vOld = diodeLinearization[idx] ?? 0
    const vGuess = iter === 0 ? vOld : vd_prev_iter
    const vd_limited = pnJunctionVoltageLimit(vGuess, vOld, vt, vcrit)
    diodeLinearization[idx] = vd_limited

    const exp_arg = Math.min(Math.max(vd_limited / vt, -50), 40)
    const exp_val = Math.exp(exp_arg)
    const id = isat * (exp_val - 1)
    const gd = Math.max((isat / vt) * exp_val, 1e-12)

    const ieq = id - gd * vd_limited

    stampAdmittanceReal(A, ckt.nodes, nPlus, nMinus, gd)
    stampCurrentReal(b, ckt.nodes, nPlus, nMinus, ieq)
  }
}

/**
 * Update switch states based on the latest solution vector.
 * Returns true if any switch changed state (causing another NR iteration).
 */
function updateSwitchStatesFromSolution(ckt: ParsedCircuit, x: number[]) {
  let switched = false
  for (const sw of ckt.S) {
    const model = sw.model
    if (!model) continue
    const vp = sw.ncPos === 0 ? 0 : (x[sw.ncPos - 1] ?? 0)
    const vn = sw.ncNeg === 0 ? 0 : (x[sw.ncNeg - 1] ?? 0)
    const vctrl = vp - vn
    let nextState = sw.isOn
    const tol = 1e-6
    if (sw.isOn) {
      if (vctrl <= model.Voff + tol) nextState = false
    } else if (vctrl >= model.Von + tol) {
      nextState = true
    }
    if (nextState !== sw.isOn) {
      sw.isOn = nextState
      switched = true
    }
  }
  return switched
}

function simulateTRAN(ckt: ParsedCircuit) {
  if (!ckt.analyses.tran) return null
  const { dt: dtRequested, tstop } = ckt.analyses.tran
  const baseDt = computeBaseTimeStep(ckt, dtRequested, tstop)
  const timePoints = buildTimePoints(ckt, baseDt, tstop)

  const nNodeVars = ckt.nodes.count() - 1
  const nVsrc = ckt.V.length
  const Nvar = nNodeVars + nVsrc

  const xPrevStep = new Array(Nvar).fill(0)

  const times: number[] = []
  const nodeVoltages: Record<string, number[]> = {}
  ckt.nodes.rev.forEach((name, id) => {
    if (id !== 0) nodeVoltages[name] = []
  })
  const elementCurrents: Record<string, number[]> = {}

  const fallbackDt = Math.max(baseDt, EPS)
  for (let idx = 0; idx < timePoints.length; idx++) {
    const t = timePoints[idx]
    if (t === undefined) continue
    const nextT = timePoints[idx + 1]
    let dt = 0
    if (idx === 0) {
      if (nextT != null) dt = nextT - t
      else dt = fallbackDt
    } else {
      const prevT = timePoints[idx - 1]
      dt = t - (prevT ?? t)
    }
    if (!Number.isFinite(dt) || dt <= 0) dt = fallbackDt
    dt = Math.max(dt, EPS)

    times.push(t)
    let x = xPrevStep.slice()
    const MAX_ITERS = 20
    const NR_TOL = 1e-6
    const diodeLinearization = ckt.D.map((d) => d.vdPrev)

    let iter
    for (iter = 0; iter < MAX_ITERS; iter++) {
      const xForLinearization = x.slice()
      const A = Array.from({ length: Nvar }, () => new Array(Nvar).fill(0))
      const b = new Array(Nvar).fill(0)

      stampAllElementsAtTime(
        A,
        b,
        ckt,
        t,
        dt,
        xForLinearization,
        iter,
        diodeLinearization,
      )

      const xNext = solveReal(A, b)

      const switched = updateSwitchStatesFromSolution(ckt, xNext)
      let maxDelta = 0
      for (let i = 0; i < Nvar; i++) {
        const delta = Math.abs(xNext[i] - (xForLinearization[i] ?? 0))
        if (delta > maxDelta) maxDelta = delta
      }

      x = xNext

      if (!switched && maxDelta < NR_TOL) {
        break
      }
    }

    if (iter >= MAX_ITERS) {
      throw new Error(
        `Newton iteration failed to converge at t=${t.toExponential()} after ${MAX_ITERS} iterations`,
      )
    }

    for (let i = 0; i < Nvar; i++) {
      xPrevStep[i] = x[i] ?? 0
    }

    for (let id = 1; id < ckt.nodes.count(); id++) {
      const idx = id - 1
      const nodeName = ckt.nodes.rev[id]
      if (!nodeName) continue
      const series = nodeVoltages[nodeName]
      if (!series) continue
      series.push(x[idx] ?? 0)
    }

    for (const r of ckt.R) {
      const v1 = r.n1 === 0 ? 0 : (x[r.n1 - 1] ?? 0)
      const v2 = r.n2 === 0 ? 0 : (x[r.n2 - 1] ?? 0)
      const i = (v1 - v2) / r.R
      ;(elementCurrents[r.name] ||= []).push(i)
    }
    for (const c of ckt.C) {
      const v1 = c.n1 === 0 ? 0 : (x[c.n1 - 1] ?? 0)
      const v2 = c.n2 === 0 ? 0 : (x[c.n2 - 1] ?? 0)
      const i = (c.C * (v1 - v2 - c.vPrev)) / Math.max(dt, EPS)
      ;(elementCurrents[c.name] ||= []).push(i)
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : (x[l.n1 - 1] ?? 0)
      const v2 = l.n2 === 0 ? 0 : (x[l.n2 - 1] ?? 0)
      const Gl = Math.max(dt, EPS) / l.L
      const i = Gl * (v1 - v2) + l.iPrev
      ;(elementCurrents[l.name] ||= []).push(i)
    }
    for (const vs of ckt.V) {
      const i = x[vs.index] ?? 0
      ;(elementCurrents[vs.name] ||= []).push(i)
    }
    for (const sw of ckt.S) {
      const model = sw.model
      if (!model) continue
      const v1 = sw.n1 === 0 ? 0 : (x[sw.n1 - 1] ?? 0)
      const v2 = sw.n2 === 0 ? 0 : (x[sw.n2 - 1] ?? 0)
      const Rvalue = sw.isOn ? model.Ron : model.Roff
      const Rclamped = Math.max(Math.abs(Rvalue), EPS)
      const i = (v1 - v2) / Rclamped
      ;(elementCurrents[sw.name] ||= []).push(i)
    }

    // Diode current calculation
    for (const d of ckt.D) {
      if (!d.model) continue
      const { nPlus, nMinus, model } = d
      const v1 = nPlus === 0 ? 0 : (x[nPlus - 1] ?? 0)
      const v2 = nMinus === 0 ? 0 : (x[nMinus - 1] ?? 0)
      let vd = v1 - v2
      if (vd > 0.8) vd = 0.8
      if (vd < -1.0) vd = -1.0

      const v_thermal = model.N * VT_300K
      const exp_val = Math.exp(vd / v_thermal)
      const id = model.Is * (exp_val - 1)
      ;(elementCurrents[d.name] ||= []).push(id)
    }

    for (const c of ckt.C) {
      const v1 = c.n1 === 0 ? 0 : (x[c.n1 - 1] ?? 0)
      const v2 = c.n2 === 0 ? 0 : (x[c.n2 - 1] ?? 0)
      c.vPrev = v1 - v2
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : (x[l.n1 - 1] ?? 0)
      const v2 = l.n2 === 0 ? 0 : (x[l.n2 - 1] ?? 0)
      const Gl = Math.max(dt, EPS) / l.L
      l.iPrev = Gl * (v1 - v2) + l.iPrev
    }

    for (const d of ckt.D) {
      const v1 = d.nPlus === 0 ? 0 : (x[d.nPlus - 1] ?? 0)
      const v2 = d.nMinus === 0 ? 0 : (x[d.nMinus - 1] ?? 0)
      d.vdPrev = v1 - v2
    }
  }

  if (ckt.probes.tran.length > 0) {
    const probedVoltages: Record<string, number[]> = {}
    const upperProbes = ckt.probes.tran.map((p) => p.toUpperCase())
    for (const nodeName in nodeVoltages) {
      if (upperProbes.includes(nodeName.toUpperCase())) {
        probedVoltages[nodeName] = nodeVoltages[nodeName]!
      }
    }
    return { times, nodeVoltages: probedVoltages, elementCurrents }
  }

  return { times, nodeVoltages, elementCurrents }
}

export { simulateTRAN }

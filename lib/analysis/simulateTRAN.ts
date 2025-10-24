import { EPS } from "../constants/EPS"
import { VT_300K } from "../constants/physics"
import { solveReal } from "../math/solveReal"
import type { ParsedCircuit } from "../parsing/parseNetlist"
import { stampAdmittanceReal } from "../stamping/stampAdmittanceReal"
import { stampCurrentReal } from "../stamping/stampCurrentReal"
import { stampVoltageSourceReal } from "../stamping/stampVoltageSourceReal"

/**
 * Compute a stable timestep and number of steps for the transient analysis.
 * - If a non-zero dt is provided, use that.
 * - Otherwise, default to 1000 steps across the stop time.
 */
function computeEffectiveTimeStep(dtRequested: number, tstop: number) {
  const MIN_STEPS = 500
  const defaultStep = tstop > 0 ? tstop / MIN_STEPS : 0
  const printStep = dtRequested > EPS ? dtRequested : defaultStep
  const internalBase = Math.max(defaultStep, EPS)
  const dtTarget =
    dtRequested > EPS ? Math.min(printStep, internalBase) : internalBase
  const steps = Math.max(1, Math.ceil(tstop / Math.max(dtTarget, EPS)))
  const dt = steps > 0 ? tstop / steps : tstop
  return { dt, steps, printStep }
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
) {
  // Resistors (conductance to ground and between nodes)
  for (const r of ckt.R) {
    const G = 1 / r.R
    stampAdmittanceReal(A, ckt.nodes, r.n1, r.n2, G)
  }

  // Capacitors via trapezoidal companion
  for (const c of ckt.C) {
    const dtEff = Math.max(dt, EPS)
    const Gc = (2 * c.C) / dtEff
    stampAdmittanceReal(A, ckt.nodes, c.n1, c.n2, Gc)
    const Ieq = -Gc * c.vPrev - c.iPrev
    stampCurrentReal(b, ckt.nodes, c.n1, c.n2, Ieq)
  }

  // Inductors via trapezoidal companion
  for (const l of ckt.L) {
    const dtEff = Math.max(dt, EPS)
    const Gl = dtEff / (2 * l.L)
    stampAdmittanceReal(A, ckt.nodes, l.n1, l.n2, Gl)
    const Ieq = l.iPrev + Gl * l.vPrev
    stampCurrentReal(b, ckt.nodes, l.n1, l.n2, Ieq)
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
  for (const d of ckt.D) {
    const model = d.model
    if (!model) continue

    const { nPlus, nMinus } = d

    const vp_idx = ckt.nodes.matrixIndexOfNode(nPlus)
    const vn_idx = ckt.nodes.matrixIndexOfNode(nMinus)

    const v_plus_prev_iter = nPlus === 0 ? 0 : (x[vp_idx] ?? 0)
    const v_minus_prev_iter = nMinus === 0 ? 0 : (x[vn_idx] ?? 0)
    const vd_prev_iter = v_plus_prev_iter - v_minus_prev_iter

    const vd = iter === 0 ? d.vdPrev : vd_prev_iter

    // Diode equation with Shockley model, using companion model for NR
    const v_thermal = model.N * VT_300K
    let vd_limited = vd
    if (vd > 0.8) vd_limited = 0.8 // prevent overflow
    if (vd < -1.0) vd_limited = -1.0 // limit reverse voltage

    const exp_val = Math.exp(vd_limited / v_thermal)
    const id = model.Is * (exp_val - 1)
    const gd = Math.max((model.Is / v_thermal) * exp_val, 1e-12)

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
    if (sw.isOn) {
      if (vctrl <= model.Voff) nextState = false
    } else if (vctrl > model.Von) {
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
  const { dt, steps, printStep } = computeEffectiveTimeStep(dtRequested, tstop)

  const nNodeVars = ckt.nodes.count() - 1
  const nVsrc = ckt.V.length
  const Nvar = nNodeVars + nVsrc

  const times: number[] = []
  const nodeVoltages: Record<string, number[]> = {}
  ckt.nodes.rev.forEach((name, id) => {
    if (id !== 0) nodeVoltages[name] = []
  })
  const elementCurrents: Record<string, number[]> = {}

  const outputEveryStep = dtRequested <= EPS || printStep <= EPS
  let nextOutputTime = 0

  const recordSnapshot = (time: number, x: number[]) => {
    times.push(time)

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
      const dtEff = Math.max(dt, EPS)
      const Gc = (2 * c.C) / dtEff
      const Ieq = -Gc * c.vPrev - c.iPrev
      const i = Gc * (v1 - v2) + Ieq
      ;(elementCurrents[c.name] ||= []).push(i)
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : (x[l.n1 - 1] ?? 0)
      const v2 = l.n2 === 0 ? 0 : (x[l.n2 - 1] ?? 0)
      const dtEff = Math.max(dt, EPS)
      const Gl = dtEff / (2 * l.L)
      const Ieq = l.iPrev + Gl * l.vPrev
      const i = Gl * (v1 - v2) + Ieq
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

    for (const d of ckt.D) {
      if (!d.model) continue
      const { nPlus, nMinus, model } = d
      const v1 = nPlus === 0 ? 0 : (x[nPlus - 1] ?? 0)
      const v2 = nMinus === 0 ? 0 : (x[nMinus - 1] ?? 0)
      const vd = v1 - v2

      const v_thermal = model.N * VT_300K
      const exp_val = Math.exp(vd / v_thermal)
      const id = model.Is * (exp_val - 1)
      ;(elementCurrents[d.name] ||= []).push(id)
    }
  }

  for (let step = 0; step <= steps; step++) {
    const t = step * dt
    let x = new Array(Nvar).fill(0)

    for (let iter = 0; iter < 20; iter++) {
      const A = Array.from({ length: Nvar }, () => new Array(Nvar).fill(0))
      const b = new Array(Nvar).fill(0)

      stampAllElementsAtTime(A, b, ckt, t, dt, x, iter)

      x = solveReal(A, b)

      const switched = updateSwitchStatesFromSolution(ckt, x)
      if (!switched) break
      if (iter === 19) break
    }

    if (outputEveryStep) {
      recordSnapshot(t, x)
    } else {
      while (
        nextOutputTime <= t + EPS &&
        nextOutputTime <= tstop + EPS &&
        printStep > EPS
      ) {
        recordSnapshot(nextOutputTime, x)
        nextOutputTime += printStep
      }
      const lastRecordedTime = times[times.length - 1]
      if (
        step === steps &&
        (lastRecordedTime == null || Math.abs(lastRecordedTime - t) > EPS)
      ) {
        recordSnapshot(t, x)
      }
    }

    for (const c of ckt.C) {
      const v1 = c.n1 === 0 ? 0 : (x[c.n1 - 1] ?? 0)
      const v2 = c.n2 === 0 ? 0 : (x[c.n2 - 1] ?? 0)
      const dtEff = Math.max(dt, EPS)
      const vNew = v1 - v2
      const iPrevOld = c.iPrev
      const Gc = (2 * c.C) / dtEff
      const iNew = Gc * (vNew - c.vPrev) - iPrevOld
      c.vPrev = vNew
      c.iPrev = iNew
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : (x[l.n1 - 1] ?? 0)
      const v2 = l.n2 === 0 ? 0 : (x[l.n2 - 1] ?? 0)
      const dtEff = Math.max(dt, EPS)
      const vNew = v1 - v2
      const Gl = dtEff / (2 * l.L)
      const iPrevOld = l.iPrev
      const iNew = iPrevOld + Gl * (vNew + l.vPrev)
      l.vPrev = vNew
      l.iPrev = iNew
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

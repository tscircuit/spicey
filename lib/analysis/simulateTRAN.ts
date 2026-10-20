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
  const dtEff = dtRequested > EPS ? dtRequested : Math.max(tstop / 1000, EPS)
  const steps = Math.max(1, Math.ceil(tstop / Math.max(dtEff, EPS)))
  const dt = steps > 0 ? tstop / steps : tstop
  return { dt, steps }
}

function pnjlim(vnew: number, vold: number, vt: number, vcrit: number) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt
      if (arg > 0) {
        return vold + vt * Math.log(arg)
      }
      return vcrit
    }
    return vt * Math.log(vnew / vt)
  }
  return vnew
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
  useTrap = false,
  vdIterMap?: Map<string, number>,
) {
  // Resistors (conductance to ground and between nodes)
  for (const r of ckt.R) {
    const G = 1 / r.R
    stampAdmittanceReal(A, ckt.nodes, r.n1, r.n2, G)
  }

  // Capacitors via companion model: Gc and Ieq
  for (const c of ckt.C) {
    if (useTrap) {
      const Gc = (2 * c.C) / Math.max(dt, EPS)
      stampAdmittanceReal(A, ckt.nodes, c.n1, c.n2, Gc)
      const Ieq = -Gc * c.vPrev - (c.iPrev ?? 0)
      stampCurrentReal(b, ckt.nodes, c.n1, c.n2, Ieq)
    } else {
      const Gc = c.C / Math.max(dt, EPS)
      stampAdmittanceReal(A, ckt.nodes, c.n1, c.n2, Gc)
      const Ieq = -Gc * c.vPrev
      stampCurrentReal(b, ckt.nodes, c.n1, c.n2, Ieq)
    }
  }

  // Inductors via Norton companion: Gl and current source
  for (const l of ckt.L) {
    if (useTrap) {
      const Gl = Math.max(dt, EPS) / (2 * l.L)
      stampAdmittanceReal(A, ckt.nodes, l.n1, l.n2, Gl)
      const Ieq = l.iPrev + Gl * (l.vPrev ?? 0)
      stampCurrentReal(b, ckt.nodes, l.n1, l.n2, Ieq)
    } else {
      const Gl = Math.max(dt, EPS) / l.L
      stampAdmittanceReal(A, ckt.nodes, l.n1, l.n2, Gl)
      stampCurrentReal(b, ckt.nodes, l.n1, l.n2, l.iPrev)
    }
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
    const vd_raw = v_plus_prev_iter - v_minus_prev_iter

    const v_thermal = model.N * VT_300K
    const vcrit = v_thermal * Math.log(v_thermal / (Math.SQRT2 * model.Is))
    const vd_old = iter === 0 ? d.vdPrev : (vdIterMap?.get(d.name) ?? d.vdPrev)
    const vd_limited =
      iter === 0 ? d.vdPrev : pnjlim(vd_raw, vd_old, v_thermal, vcrit)
    vdIterMap?.set(d.name, vd_limited)

    const exp_val = Math.exp(Math.min(vd_limited / v_thermal, 80))
    const id = model.Is * (exp_val - 1) + 1e-12 * vd_limited
    const gd = (model.Is / v_thermal) * exp_val + 1e-12

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
      if (model.Von === model.Voff ? vctrl <= model.Voff : vctrl < model.Voff) {
        nextState = false
      }
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

type TranStep = {
  t: number
  dt: number
  useTrap: boolean
}

function buildTranSteps(
  ckt: ParsedCircuit,
  dt: number,
  steps: number,
  tstop: number,
): TranStep[] {
  const pulseSources = ckt.V.filter((v) => v.pulse != null).map((v) => v.pulse!)
  const needsBreakpointStepping = pulseSources.some((p) => {
    const offTime = Math.max(p.period - p.ton - p.tr - p.tf, EPS)
    const minFeature = Math.min(Math.max(p.ton, EPS), offTime)
    return dt > minFeature * 0.5
  })

  if (!needsBreakpointStepping) {
    const result: TranStep[] = []
    for (let step = 0; step <= steps; step++) {
      result.push({
        t: step * dt,
        dt,
        useTrap: false,
      })
    }
    return result
  }

  // Build SPICE breakpoint table from PULSE sources (matching SPICE3f5 vsrcacct.c)
  const bpSet: number[] = [0, tstop]
  for (const p of pulseSources) {
    if (p.td >= 0 && p.td <= tstop) bpSet.push(p.td)
    const maxCycles = Math.min(
      p.ncycles,
      Math.ceil((tstop - p.td) / Math.max(p.period, EPS)) + 1,
    )
    for (let k = 0; k < maxCycles; k++) {
      const base = p.td + k * p.period
      if (base > tstop + EPS) break
      const tOnEnd = base + p.tr + p.ton
      const tCycleEnd = base + p.period
      if (tOnEnd >= 0 && tOnEnd <= tstop) bpSet.push(tOnEnd)
      if (tCycleEnd >= 0 && tCycleEnd <= tstop) bpSet.push(tCycleEnd)
    }
  }
  bpSet.sort((a, b) => a - b)
  const bps: number[] = []
  for (const bp of bpSet) {
    if (bps.length === 0 || bp - bps[bps.length - 1]! > 1e-9) {
      bps.push(bp)
    }
  }

  const tranSteps: TranStep[] = []
  let t = 0
  let saveDelta = dt
  for (let bi = 0; bi < bps.length - 1; bi++) {
    const bNext = bps[bi + 1]!
    const span = bNext - t
    if (span <= 1e-12) continue
    let delta =
      bi === 0
        ? 0.01 * span
        : bi === 1
          ? (0.1 * Math.min(saveDelta, span)) / 8
          : 0.1 * Math.min(saveDelta, span)
    let stepInSegment = 0
    while (t < bNext - 1e-12) {
      const reachesBreakpoint = t + delta >= bNext - 1e-12
      const nextT = reachesBreakpoint ? bNext : t + delta
      const stepDt = nextT - t
      t = nextT
      tranSteps.push({
        t,
        dt: stepDt,
        useTrap: stepInSegment > 0,
      })
      if (!reachesBreakpoint) {
        if (!(bi === 0 && stepInSegment === 0)) {
          delta *= 2
        }
        saveDelta = delta
      }
      stepInSegment++
    }
  }

  return tranSteps
}

function simulateTRAN(ckt: ParsedCircuit) {
  if (!ckt.analyses.tran) return null
  const { dt: dtRequested, tstop } = ckt.analyses.tran
  const { dt, steps } = computeEffectiveTimeStep(dtRequested, tstop)
  const tranSteps = buildTranSteps(ckt, dt, steps, tstop)

  const nNodeVars = ckt.nodes.count() - 1
  const nVsrc = ckt.V.length
  const Nvar = nNodeVars + nVsrc

  const times: number[] = []
  const nodeVoltages: Record<string, number[]> = {}
  ckt.nodes.rev.forEach((name, id) => {
    if (id !== 0) nodeVoltages[name] = []
  })
  const elementCurrents: Record<string, number[]> = {}

  for (const stepInfo of tranSteps) {
    const { t, dt: stepDt, useTrap } = stepInfo
    times.push(t)
    let x = new Array(Nvar).fill(0)
    const vdIterMap = new Map<string, number>()

    const maxIter = ckt.D.length > 0 ? 50 : 20
    for (let iter = 0; iter < maxIter; iter++) {
      const A = Array.from({ length: Nvar }, () => new Array(Nvar).fill(0))
      const b = new Array(Nvar).fill(0)

      stampAllElementsAtTime(A, b, ckt, t, stepDt, x, iter, useTrap, vdIterMap)

      x = solveReal(A, b)

      const switched = updateSwitchStatesFromSolution(ckt, x)
      let diodesConverged = true
      if (ckt.D.length > 0) {
        for (const d of ckt.D) {
          const vp = d.nPlus === 0 ? 0 : (x[d.nPlus - 1] ?? 0)
          const vn = d.nMinus === 0 ? 0 : (x[d.nMinus - 1] ?? 0)
          const vdNew = vp - vn
          const vdOld = vdIterMap.get(d.name) ?? d.vdPrev
          if (Math.abs(vdNew - vdOld) > 1e-6) {
            diodesConverged = false
            break
          }
        }
      }
      if (!switched && diodesConverged) break
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
      const vNew = v1 - v2
      const i = useTrap
        ? ((2 * c.C) / Math.max(stepDt, EPS)) * (vNew - c.vPrev) +
          (c.iPrev ?? 0)
        : (c.C * (vNew - c.vPrev)) / Math.max(stepDt, EPS)
      ;(elementCurrents[c.name] ||= []).push(i)
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : (x[l.n1 - 1] ?? 0)
      const v2 = l.n2 === 0 ? 0 : (x[l.n2 - 1] ?? 0)
      const vNew = v1 - v2
      const i = useTrap
        ? (Math.max(stepDt, EPS) / (2 * l.L)) * (vNew + (l.vPrev ?? 0)) +
          l.iPrev
        : (Math.max(stepDt, EPS) / l.L) * vNew + l.iPrev
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
      const vd = v1 - v2

      const v_thermal = model.N * VT_300K
      const exp_val = Math.exp(Math.min(vd / v_thermal, 80))
      const id = model.Is * (exp_val - 1)
      ;(elementCurrents[d.name] ||= []).push(id)
    }

    for (const c of ckt.C) {
      const v1 = c.n1 === 0 ? 0 : (x[c.n1 - 1] ?? 0)
      const v2 = c.n2 === 0 ? 0 : (x[c.n2 - 1] ?? 0)
      const vNew = v1 - v2
      c.iPrev = useTrap
        ? ((2 * c.C) / Math.max(stepDt, EPS)) * (vNew - c.vPrev) -
          (c.iPrev ?? 0)
        : (c.C * (vNew - c.vPrev)) / Math.max(stepDt, EPS)
      c.vPrev = vNew
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : (x[l.n1 - 1] ?? 0)
      const v2 = l.n2 === 0 ? 0 : (x[l.n2 - 1] ?? 0)
      const vNew = v1 - v2
      l.iPrev = useTrap
        ? (Math.max(stepDt, EPS) / (2 * l.L)) * (vNew + (l.vPrev ?? 0)) +
          l.iPrev
        : (Math.max(stepDt, EPS) / l.L) * vNew + l.iPrev
      l.vPrev = vNew
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

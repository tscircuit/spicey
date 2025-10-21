import { EPS } from "../constants/EPS"
import { VT_300K } from "../constants/physics"
import { solveReal } from "../math/solveReal"
import type { ParsedCircuit } from "../parsing/parseNetlist"
import { stampAdmittanceReal } from "../stamping/stampAdmittanceReal"
import { stampCurrentReal } from "../stamping/stampCurrentReal"
import { stampVoltageSourceReal } from "../stamping/stampVoltageSourceReal"

function collectTranBreakpoints(ckt: ParsedCircuit, tstop: number) {
  const points = new Set<number>([0, tstop])
  for (const vs of ckt.V) {
    const info = vs.waveformInfo
    if (!info) continue
    if (info.type === "pulse") {
      const { td, tr, tf, ton, period, ncycles } = info.spec
      const effectivePeriod =
        period > EPS ? period : tstop + td + ton + tf + EPS
      const maxCycles = Number.isFinite(ncycles)
        ? Math.max(1, Math.trunc(ncycles))
        : Math.ceil(Math.max(tstop - td, 0) / Math.max(effectivePeriod, EPS)) +
          2
      for (let cycle = 0; cycle < maxCycles; cycle++) {
        const base = td + cycle * effectivePeriod
        if (base > tstop + EPS) break
        const riseStart = base
        const riseEnd = base + tr
        const highEnd = riseEnd + ton
        const fallEnd = highEnd + tf
        if (riseStart >= 0 && riseStart <= tstop + EPS) points.add(riseStart)
        if (riseEnd >= 0 && riseEnd <= tstop + EPS) points.add(riseEnd)
        if (highEnd >= 0 && highEnd <= tstop + EPS) points.add(highEnd)
        if (fallEnd >= 0 && fallEnd <= tstop + EPS) points.add(fallEnd)
        if (!Number.isFinite(period) || effectivePeriod === Infinity) break
      }
    }
  }
  const ordered = Array.from(points)
    .filter((t) => t >= 0 && t <= tstop + EPS)
    .sort((a, b) => a - b)
  const deduped: number[] = []
  let last = -Infinity
  for (const t of ordered) {
    if (deduped.length === 0 || Math.abs(t - last) > 1e-12) {
      deduped.push(t)
      last = t
    }
  }
  return deduped
}

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
    const ctrlTol = 1e-6
    if (sw.isOn) {
      if (vctrl <= model.Voff + ctrlTol) nextState = false
    } else if (vctrl >= model.Von - ctrlTol) {
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
  const { dt, steps } = computeEffectiveTimeStep(dtRequested, tstop)

  const nNodeVars = ckt.nodes.count() - 1
  const nVsrc = ckt.V.length
  const Nvar = nNodeVars + nVsrc

  const times: number[] = []
  const nodeVoltages: Record<string, number[]> = {}
  ckt.nodes.rev.forEach((name, id) => {
    if (id !== 0) nodeVoltages[name] = []
  })
  const elementCurrents: Record<string, number[]> = {}

  const outputTimes: number[] = []
  for (let step = 0; step <= steps; step++) {
    const tVal = step * dt
    outputTimes.push(step === steps ? tstop : Math.min(tVal, tstop))
  }
  const breakpoints = collectTranBreakpoints(ckt, tstop)
  const allTimes = new Set<number>([...outputTimes, ...breakpoints])
  const timeGrid = Array.from(allTimes)
    .filter((time) => time >= 0 && time <= tstop + EPS)
    .sort((a, b) => a - b)

  const dedupedTimes: number[] = []
  let lastTime = -Infinity
  for (const time of timeGrid) {
    if (dedupedTimes.length === 0 || Math.abs(time - lastTime) > 1e-12) {
      dedupedTimes.push(time)
      lastTime = time
    }
  }

  const expandedTimes: number[] = []
  const maxInternalDt = dt > EPS ? dt / 200 : Math.max(tstop / 1000, EPS)
  if (dedupedTimes.length > 0) {
    for (let i = 0; i < dedupedTimes.length - 1; i++) {
      const start = dedupedTimes[i]!
      const end = dedupedTimes[i + 1]!
      expandedTimes.push(start)
      const segment = end - start
      if (segment <= EPS) continue
      const internalDt = Math.max(Math.min(segment, maxInternalDt), EPS)
      const subdivisions = Math.max(1, Math.ceil(segment / internalDt))
      for (let s = 1; s < subdivisions; s++) {
        expandedTimes.push(start + (segment * s) / subdivisions)
      }
    }
    expandedTimes.push(dedupedTimes[dedupedTimes.length - 1]!)
  }

  const timeSequence = expandedTimes.length > 0 ? expandedTimes : dedupedTimes

  let prevSolution: number[] | null = null
  let outputIndex = 0

  for (let idx = 0; idx < timeSequence.length; idx++) {
    const tCurrent = timeSequence[idx]!
    const prevTime = idx === 0 ? tCurrent : timeSequence[idx - 1]!
    const nextTime = timeSequence[idx + 1] ?? tCurrent
    const stepDt =
      idx === 0
        ? Math.max(nextTime - tCurrent, EPS)
        : Math.max(tCurrent - prevTime, EPS)

    let x: number[] = prevSolution ? [...prevSolution] : new Array(Nvar).fill(0)

    for (let iter = 0; iter < 20; iter++) {
      const A = Array.from({ length: Nvar }, () => new Array(Nvar).fill(0))
      const b = new Array(Nvar).fill(0)

      stampAllElementsAtTime(A, b, ckt, tCurrent, stepDt, x, iter)

      const newX = solveReal(A, b)

      const switched = updateSwitchStatesFromSolution(ckt, newX)

      let maxDelta = 0
      for (let i = 0; i < Nvar; i++) {
        const delta = Math.abs(newX[i]! - (x[i] ?? 0))
        if (delta > maxDelta) maxDelta = delta
      }

      x = newX

      if (!switched && maxDelta < 1e-6) break
      if (iter === 19) break
    }

    prevSolution = [...x]

    const targetOutput = outputTimes[outputIndex]
    const timeTolerance = Math.max(stepDt, dt, 1e-12) * 1e-6 + 1e-12
    const shouldRecord =
      targetOutput != null && Math.abs(tCurrent - targetOutput) <= timeTolerance

    if (shouldRecord) {
      times.push(tCurrent)
      for (let id = 1; id < ckt.nodes.count(); id++) {
        const idxVar = id - 1
        const nodeName = ckt.nodes.rev[id]
        if (!nodeName) continue
        const series = nodeVoltages[nodeName]
        if (!series) continue
        series.push(x[idxVar] ?? 0)
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
        const i = (c.C * (v1 - v2 - c.vPrev)) / Math.max(stepDt, EPS)
        ;(elementCurrents[c.name] ||= []).push(i)
      }
      for (const l of ckt.L) {
        const v1 = l.n1 === 0 ? 0 : (x[l.n1 - 1] ?? 0)
        const v2 = l.n2 === 0 ? 0 : (x[l.n2 - 1] ?? 0)
        const newI = (Math.max(stepDt, EPS) / l.L) * (v1 - v2) + l.iPrev
        ;(elementCurrents[l.name] ||= []).push(newI)
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

      outputIndex++
    }

    for (const c of ckt.C) {
      const v1 = c.n1 === 0 ? 0 : (x[c.n1 - 1] ?? 0)
      const v2 = c.n2 === 0 ? 0 : (x[c.n2 - 1] ?? 0)
      c.vPrev = v1 - v2
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : (x[l.n1 - 1] ?? 0)
      const v2 = l.n2 === 0 ? 0 : (x[l.n2 - 1] ?? 0)
      const dtForState = Math.max(stepDt, EPS)
      l.iPrev = (dtForState / l.L) * (v1 - v2) + l.iPrev
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

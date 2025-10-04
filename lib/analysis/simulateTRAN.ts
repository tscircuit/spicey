import { EPS } from "../constants/EPS"
import { solveReal } from "../math/solveReal"
import type { ParsedCircuit } from "../parsing/parseNetlist"
import { stampAdmittanceReal } from "../stamping/stampAdmittanceReal"
import { stampCurrentReal } from "../stamping/stampCurrentReal"
import { stampVoltageSourceReal } from "../stamping/stampVoltageSourceReal"
import { stampTransconductanceReal } from "../stamping/stampTransconductanceReal"

function simulateTRAN(ckt: ParsedCircuit) {
  if (!ckt.analyses.tran) return null
  const { dt, tstop } = ckt.analyses.tran
  const steps = Math.max(1, Math.ceil(tstop / Math.max(dt, EPS)))

  const nNodeVars = ckt.nodes.count() - 1
  const nVsrc = ckt.V.length
  const Nvar = nNodeVars + nVsrc

  const times: number[] = []
  const nodeVoltages: Record<string, number[]> = {}
  ckt.nodes.rev.forEach((name, id) => {
    if (id !== 0) nodeVoltages[name] = []
  })
  const elementCurrents: Record<string, number[]> = {}

  const blankA = () =>
    Array.from({ length: Nvar }, () => new Array(Nvar).fill(0))
  const blankB = () => new Array(Nvar).fill(0)

  let t = 0
  for (let step = 0; step <= steps; step++, t = step * dt) {
    times.push(t)
    const A = blankA()
    const b = blankB()

    for (const r of ckt.R) {
      const G = 1 / r.R
      stampAdmittanceReal(A, ckt.nodes, r.n1, r.n2, G)
    }

    for (const c of ckt.C) {
      const Gc = c.C / Math.max(dt, EPS)
      stampAdmittanceReal(A, ckt.nodes, c.n1, c.n2, Gc)
      const Ieq = -Gc * c.vPrev
      stampCurrentReal(b, ckt.nodes, c.n1, c.n2, Ieq)
    }

    for (const l of ckt.L) {
      const Gl = Math.max(dt, EPS) / l.L
      stampAdmittanceReal(A, ckt.nodes, l.n1, l.n2, Gl)
      stampCurrentReal(b, ckt.nodes, l.n1, l.n2, l.iPrev)
    }

    for (const vs of ckt.V) {
      const Vt = vs.waveform ? vs.waveform(t) : vs.dc || 0
      stampVoltageSourceReal(A, b, ckt.nodes, vs, Vt)
    }

    for (const q of ckt.Q) {
      if (q.gpi > 0) stampAdmittanceReal(A, ckt.nodes, q.nb, q.ne, q.gpi)
      if (q.gco > 0) stampAdmittanceReal(A, ckt.nodes, q.nc, q.ne, q.gco)
      if (q.gm !== 0)
        stampTransconductanceReal(A, ckt.nodes, q.nc, q.ne, q.nb, q.ne, q.gm)
    }

    const x = solveReal(A, b)

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

    for (const q of ckt.Q) {
      const vb = q.nb === 0 ? 0 : (x[q.nb - 1] ?? 0)
      const vc = q.nc === 0 ? 0 : (x[q.nc - 1] ?? 0)
      const ve = q.ne === 0 ? 0 : (x[q.ne - 1] ?? 0)
      const vbe = vb - ve
      const vce = vc - ve
      const ic = q.gm * vbe + q.gco * vce
      ;(elementCurrents[q.name] ||= []).push(ic)
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
  }

  return { times, nodeVoltages, elementCurrents }
}

export { simulateTRAN }

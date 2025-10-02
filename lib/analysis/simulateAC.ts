import { EPS } from "../constants/EPS"
import { Complex } from "../math/Complex"
import { solveComplex } from "../math/solveComplex"
import type { ParsedCircuit } from "../parsing/parseNetlist"
import { logspace } from "../utils/logspace"
import { stampAdmittanceComplex } from "../stamping/stampAdmittanceComplex"
import { stampVoltageSourceComplex } from "../stamping/stampVoltageSourceComplex"

function simulateAC(ckt: ParsedCircuit) {
  if (!ckt.analyses.ac) return null

  const { mode, N, f1, f2 } = ckt.analyses.ac
  const nNodeVars = ckt.nodes.count() - 1
  const nVsrc = ckt.V.length
  const Nvar = nNodeVars + nVsrc

  const freqs =
    mode === "dec"
      ? logspace(f1, f2, N)
      : (() => {
          const arr: number[] = []
          const npts = Math.max(2, N)
          const step = (f2 - f1) / (npts - 1)
          for (let i = 0; i < npts; i++) arr.push(f1 + i * step)
          return arr
        })()

  const nodeVoltages: Record<string, Complex[]> = {}
  ckt.nodes.rev.forEach((name, id) => {
    if (id !== 0) nodeVoltages[name] = []
  })
  const elementCurrents: Record<string, Complex[]> = {}

  const twoPi = 2 * Math.PI

  for (const f of freqs) {
    const A = Array.from({ length: Nvar }, () =>
      Array.from({ length: Nvar }, () => Complex.from(0, 0)),
    )
    const b = Array.from({ length: Nvar }, () => Complex.from(0, 0))

    for (const r of ckt.R) {
      if (r.R <= 0) throw new Error(`R ${r.name} must be > 0`)
      const Y = Complex.from(1 / r.R, 0)
      stampAdmittanceComplex(A, ckt.nodes, r.n1, r.n2, Y)
    }

    for (const c of ckt.C) {
      const Y = Complex.from(0, twoPi * f * c.C)
      stampAdmittanceComplex(A, ckt.nodes, c.n1, c.n2, Y)
    }

    for (const l of ckt.L) {
      const denom = Complex.from(0, twoPi * f * l.L)
      const Y =
        denom.abs() < EPS ? Complex.from(0, 0) : Complex.from(1, 0).div(denom)
      stampAdmittanceComplex(A, ckt.nodes, l.n1, l.n2, Y)
    }

    for (const vs of ckt.V) {
      const Vph = Complex.fromPolar(vs.acMag || 0, vs.acPhaseDeg || 0)
      stampVoltageSourceComplex(A, b, ckt.nodes, vs, Vph)
    }

    const x = solveComplex(A, b)

    for (let id = 1; id < ckt.nodes.count(); id++) {
      const idx = id - 1
      const nodeName = ckt.nodes.rev[id]
      if (!nodeName) continue
      const series = nodeVoltages[nodeName]
      if (!series) continue
      series.push(x[idx] ?? Complex.from(0, 0))
    }

    for (const r of ckt.R) {
      const v1 =
        r.n1 === 0 ? Complex.from(0, 0) : (x[r.n1 - 1] ?? Complex.from(0, 0))
      const v2 =
        r.n2 === 0 ? Complex.from(0, 0) : (x[r.n2 - 1] ?? Complex.from(0, 0))
      const Y = Complex.from(1 / r.R, 0)
      const i = Y.mul(v1.sub(v2))
      ;(elementCurrents[r.name] ||= []).push(i)
    }
    for (const c of ckt.C) {
      const v1 =
        c.n1 === 0 ? Complex.from(0, 0) : (x[c.n1 - 1] ?? Complex.from(0, 0))
      const v2 =
        c.n2 === 0 ? Complex.from(0, 0) : (x[c.n2 - 1] ?? Complex.from(0, 0))
      const Y = Complex.from(0, twoPi * f * c.C)
      const i = Y.mul(v1.sub(v2))
      ;(elementCurrents[c.name] ||= []).push(i)
    }
    for (const l of ckt.L) {
      const v1 =
        l.n1 === 0 ? Complex.from(0, 0) : (x[l.n1 - 1] ?? Complex.from(0, 0))
      const v2 =
        l.n2 === 0 ? Complex.from(0, 0) : (x[l.n2 - 1] ?? Complex.from(0, 0))
      const denom = Complex.from(0, twoPi * f * l.L)
      const Y =
        denom.abs() < EPS ? Complex.from(0, 0) : Complex.from(1, 0).div(denom)
      const i = Y.mul(v1.sub(v2))
      ;(elementCurrents[l.name] ||= []).push(i)
    }
    for (const vs of ckt.V) {
      const i = x[vs.index] ?? Complex.from(0, 0)
      ;(elementCurrents[vs.name] ||= []).push(i)
    }
  }

  return { freqs, nodeVoltages, elementCurrents }
}

export { simulateAC }

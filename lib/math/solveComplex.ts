import { EPS } from "../constants/EPS"
import { Complex } from "./Complex"

function solveComplex(A: Complex[][], b: Complex[]) {
  const n = A.length
  for (let i = 0; i < n; i++) {
    const row = A[i]
    const bi = b[i]
    if (!row || !bi) throw new Error("Matrix dimensions mismatch")
    const copy = row.map((z) => z.clone())
    copy.push(bi.clone())
    A[i] = copy
  }

  for (let k = 0; k < n; k++) {
    let imax = k
    const pivotRow = A[k]
    if (!pivotRow) throw new Error("Matrix row missing")
    let vmax = pivotRow[k]?.abs() ?? 0
    for (let i = k + 1; i < n; i++) {
      const row = A[i]
      if (!row) throw new Error("Matrix row missing")
      const v = row[k]?.abs() ?? 0
      if (v > vmax) {
        vmax = v
        imax = i
      }
    }
    if (vmax < EPS) throw new Error("Singular matrix (complex)")
    if (imax !== k) {
      const tmp = A[k]
      A[k] = A[imax]!
      A[imax] = tmp!
    }

    const pivotRowUpdated = A[k]
    if (!pivotRowUpdated) throw new Error("Pivot row missing")
    const pivot = pivotRowUpdated[k]
    if (!pivot) throw new Error("Zero pivot encountered")
    for (let i = k + 1; i < n; i++) {
      const row = A[i]
      if (!row) throw new Error("Matrix row missing")
      const entry = row[k]
      if (!entry) continue
      const f = entry.div(pivot)
      if (f.abs() < EPS) continue
      for (let j = k; j <= n; j++) {
        const target = row[j]
        const source = pivotRowUpdated[j]
        if (!target || !source) continue
        row[j] = target.sub(f.mul(source))
      }
    }
  }

  const x = new Array(n)
  for (let i = n - 1; i >= 0; i--) {
    const row = A[i]
    if (!row) throw new Error("Matrix row missing")
    let s = row[n]
    if (!s) throw new Error("Augmented column missing")
    for (let j = i + 1; j < n; j++) {
      const coeff = row[j]
      const sol = x[j]
      if (!coeff || !sol) continue
      s = s.sub(coeff.mul(sol))
    }
    const pivot = row[i]
    if (!pivot) throw new Error("Zero pivot on back-substitution")
    x[i] = s.div(pivot)
  }
  return x
}

export { solveComplex }

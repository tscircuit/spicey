import { EPS } from "../constants/EPS"

function solveReal(A: number[][], b: number[]) {
  const n = A.length
  for (let i = 0; i < n; i++) {
    const row = A[i]
    const bi = b[i]
    if (!row || bi == null) throw new Error("Matrix dimensions mismatch")
    const copy = row.slice()
    copy.push(bi)
    A[i] = copy
  }

  for (let k = 0; k < n; k++) {
    let imax = k
    const pivotRow = A[k]
    if (!pivotRow) throw new Error("Matrix row missing")
    let vmax = Math.abs(pivotRow[k] ?? 0)
    for (let i = k + 1; i < n; i++) {
      const row = A[i]
      if (!row) throw new Error("Matrix row missing")
      const v = Math.abs(row[k] ?? 0)
      if (v > vmax) {
        vmax = v
        imax = i
      }
    }
    if (vmax < EPS) throw new Error("Singular matrix (real)")

    if (imax !== k) {
      const tmp = A[k]
      A[k] = A[imax]!
      A[imax] = tmp!
    }

    const pivotRowUpdated = A[k]
    if (!pivotRowUpdated) throw new Error("Pivot row missing")
    const pivot = pivotRowUpdated[k]
    if (pivot == null) throw new Error("Zero pivot encountered")
    for (let i = k + 1; i < n; i++) {
      const row = A[i]
      if (!row) throw new Error("Matrix row missing")
      const entry = row[k]
      if (entry == null) continue
      const f = entry / pivot
      if (Math.abs(f) < EPS) continue
      for (let j = k; j <= n; j++) {
        const target = row[j]
        const source = pivotRowUpdated[j]
        if (target == null || source == null) continue
        row[j] = target - f * source
      }
    }
  }

  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    const row = A[i]
    if (!row) throw new Error("Matrix row missing")
    let s = row[n]
    if (s == null) throw new Error("Augmented column missing")
    for (let j = i + 1; j < n; j++) {
      const coeff = row[j]
      const sol = x[j]
      if (coeff == null || sol == null) continue
      s -= coeff * sol
    }
    const pivot = row[i]
    if (pivot == null) throw new Error("Zero pivot on back-substitution")
    x[i] = s / pivot
  }
  return x
}

export { solveReal }

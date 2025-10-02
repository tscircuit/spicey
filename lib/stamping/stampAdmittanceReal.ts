import type { CircuitNodeIndex } from "../parsing/parseNetlist"

function stampAdmittanceReal(
  A: number[][],
  nidx: CircuitNodeIndex,
  n1: number,
  n2: number,
  Y: number,
) {
  const i1 = nidx.matrixIndexOfNode(n1)
  const i2 = nidx.matrixIndexOfNode(n2)
  if (i1 >= 0) {
    const row1 = A[i1]
    if (!row1) throw new Error("Matrix row missing while stamping")
    row1[i1] = (row1[i1] ?? 0) + Y
  }
  if (i2 >= 0) {
    const row2 = A[i2]
    if (!row2) throw new Error("Matrix row missing while stamping")
    row2[i2] = (row2[i2] ?? 0) + Y
  }
  if (i1 >= 0 && i2 >= 0) {
    const row1 = A[i1]
    const row2 = A[i2]
    if (!row1 || !row2) throw new Error("Matrix row missing while stamping")
    row1[i2] = (row1[i2] ?? 0) - Y
    row2[i1] = (row2[i1] ?? 0) - Y
  }
}

export { stampAdmittanceReal }

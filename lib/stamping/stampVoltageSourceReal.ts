import type { ParsedVoltageSource } from "../parsing/parseNetlist"
import type { CircuitNodeIndex } from "../parsing/parseNetlist"

function stampVoltageSourceReal(
  A: number[][],
  b: number[],
  nidx: CircuitNodeIndex,
  source: ParsedVoltageSource,
  voltage: number,
) {
  const i1 = nidx.matrixIndexOfNode(source.n1)
  const i2 = nidx.matrixIndexOfNode(source.n2)
  const j = source.index
  if (i1 >= 0) {
    const row1 = A[i1]
    if (!row1)
      throw new Error("Matrix row missing while stamping voltage source")
    row1[j] = (row1[j] ?? 0) + 1
  }
  if (i2 >= 0) {
    const row2 = A[i2]
    if (!row2)
      throw new Error("Matrix row missing while stamping voltage source")
    row2[j] = (row2[j] ?? 0) - 1
  }
  const branchRow = A[j]
  if (!branchRow)
    throw new Error("Branch row missing while stamping voltage source")
  if (i1 >= 0) branchRow[i1] = (branchRow[i1] ?? 0) + 1
  if (i2 >= 0) branchRow[i2] = (branchRow[i2] ?? 0) - 1
  b[j] = (b[j] ?? 0) + voltage
}

export { stampVoltageSourceReal }

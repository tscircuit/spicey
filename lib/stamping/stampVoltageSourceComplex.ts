import type { ParsedVoltageSource } from "../parsing/parseNetlist"
import type { CircuitNodeIndex } from "../parsing/parseNetlist"
import { Complex } from "../math/Complex"

function stampVoltageSourceComplex(
  A: Complex[][],
  b: Complex[],
  nidx: CircuitNodeIndex,
  source: ParsedVoltageSource,
  voltage: Complex,
) {
  const i1 = nidx.matrixIndexOfNode(source.n1)
  const i2 = nidx.matrixIndexOfNode(source.n2)
  const j = source.index
  const one = Complex.from(1, 0)
  const negOne = Complex.from(-1, 0)
  if (i1 >= 0) {
    const row1 = A[i1]
    if (!row1)
      throw new Error("Matrix row missing while stamping voltage source")
    row1[j] = row1[j]?.add(one) ?? one
  }
  if (i2 >= 0) {
    const row2 = A[i2]
    if (!row2)
      throw new Error("Matrix row missing while stamping voltage source")
    row2[j] = row2[j]?.sub(one) ?? negOne
  }
  const branchRow = A[j]
  if (!branchRow)
    throw new Error("Branch row missing while stamping voltage source")
  if (i1 >= 0) branchRow[i1] = branchRow[i1]?.add(one) ?? one
  if (i2 >= 0) branchRow[i2] = branchRow[i2]?.sub(one) ?? negOne
  b[j] = (b[j] ?? Complex.from(0, 0)).add(voltage)
}

export { stampVoltageSourceComplex }

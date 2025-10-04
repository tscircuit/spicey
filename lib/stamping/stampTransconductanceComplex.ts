import { Complex } from "../math/Complex"
import type { CircuitNodeIndex } from "../parsing/parseNetlist"

function stampTransconductanceComplex(
  A: Complex[][],
  nidx: CircuitNodeIndex,
  nPlus: number,
  nMinus: number,
  ctrlPlus: number,
  ctrlMinus: number,
  gm: Complex,
) {
  if (gm.re === 0 && gm.im === 0) return
  const outPlus = nidx.matrixIndexOfNode(nPlus)
  const outMinus = nidx.matrixIndexOfNode(nMinus)
  const ctrlPlusIdx = nidx.matrixIndexOfNode(ctrlPlus)
  const ctrlMinusIdx = nidx.matrixIndexOfNode(ctrlMinus)

  if (outPlus >= 0) {
    const row = A[outPlus]
    if (!row)
      throw new Error("Matrix row missing while stamping transconductance")
    if (ctrlPlusIdx >= 0)
      row[ctrlPlusIdx] = (row[ctrlPlusIdx] ?? Complex.from(0, 0)).add(gm)
    if (ctrlMinusIdx >= 0)
      row[ctrlMinusIdx] = (row[ctrlMinusIdx] ?? Complex.from(0, 0)).sub(gm)
  }

  if (outMinus >= 0) {
    const row = A[outMinus]
    if (!row)
      throw new Error("Matrix row missing while stamping transconductance")
    if (ctrlPlusIdx >= 0)
      row[ctrlPlusIdx] = (row[ctrlPlusIdx] ?? Complex.from(0, 0)).sub(gm)
    if (ctrlMinusIdx >= 0)
      row[ctrlMinusIdx] = (row[ctrlMinusIdx] ?? Complex.from(0, 0)).add(gm)
  }
}

export { stampTransconductanceComplex }

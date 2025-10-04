import type { CircuitNodeIndex } from "../parsing/parseNetlist"

function stampTransconductanceReal(
  A: number[][],
  nidx: CircuitNodeIndex,
  nPlus: number,
  nMinus: number,
  ctrlPlus: number,
  ctrlMinus: number,
  gm: number,
) {
  if (gm === 0) return
  const outPlus = nidx.matrixIndexOfNode(nPlus)
  const outMinus = nidx.matrixIndexOfNode(nMinus)
  const ctrlPlusIdx = nidx.matrixIndexOfNode(ctrlPlus)
  const ctrlMinusIdx = nidx.matrixIndexOfNode(ctrlMinus)

  if (outPlus >= 0) {
    const row = A[outPlus]
    if (!row)
      throw new Error("Matrix row missing while stamping transconductance")
    if (ctrlPlusIdx >= 0) row[ctrlPlusIdx] = (row[ctrlPlusIdx] ?? 0) + gm
    if (ctrlMinusIdx >= 0) row[ctrlMinusIdx] = (row[ctrlMinusIdx] ?? 0) - gm
  }

  if (outMinus >= 0) {
    const row = A[outMinus]
    if (!row)
      throw new Error("Matrix row missing while stamping transconductance")
    if (ctrlPlusIdx >= 0) row[ctrlPlusIdx] = (row[ctrlPlusIdx] ?? 0) - gm
    if (ctrlMinusIdx >= 0) row[ctrlMinusIdx] = (row[ctrlMinusIdx] ?? 0) + gm
  }
}

export { stampTransconductanceReal }

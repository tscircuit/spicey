import type { CircuitNodeIndex } from "../parsing/parseNetlist"

function stampCurrentReal(
  b: number[],
  nidx: CircuitNodeIndex,
  nPlus: number,
  nMinus: number,
  current: number,
) {
  const iPlus = nidx.matrixIndexOfNode(nPlus)
  const iMinus = nidx.matrixIndexOfNode(nMinus)
  if (iPlus >= 0) b[iPlus] = (b[iPlus] ?? 0) - current
  if (iMinus >= 0) b[iMinus] = (b[iMinus] ?? 0) + current
}

export { stampCurrentReal }

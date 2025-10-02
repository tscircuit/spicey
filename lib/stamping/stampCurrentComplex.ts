import type { CircuitNodeIndex } from "../parsing/parseNetlist"
import { Complex } from "../math/Complex"

function stampCurrentComplex(
  b: Complex[],
  nidx: CircuitNodeIndex,
  nPlus: number,
  nMinus: number,
  current: Complex,
) {
  const iPlus = nidx.matrixIndexOfNode(nPlus)
  const iMinus = nidx.matrixIndexOfNode(nMinus)
  if (iPlus >= 0) b[iPlus] = (b[iPlus] ?? Complex.from(0, 0)).sub(current)
  if (iMinus >= 0) b[iMinus] = (b[iMinus] ?? Complex.from(0, 0)).add(current)
}

export { stampCurrentComplex }

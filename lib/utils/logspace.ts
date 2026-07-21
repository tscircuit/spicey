import { EPS } from "../constants/EPS"

function logspace(
  f1: number,
  f2: number,
  pointsPerInterval: number,
  intervalBase = 10,
) {
  if (f1 <= 0 || f2 <= 0) throw new Error(".ac frequencies must be > 0")
  if (f2 < f1) [f1, f2] = [f2, f1]
  const intervals = Math.log(f2 / f1) / Math.log(intervalBase)
  const pointCount = Math.max(1, Math.floor(intervals * pointsPerInterval))
  const arr: number[] = []
  for (let pointIndex = 0; pointIndex <= pointCount; pointIndex++) {
    arr.push(f1 * Math.pow(intervalBase, pointIndex / pointsPerInterval))
  }
  const last = arr[arr.length - 1]
  if (last == null || last < f2 * (1 - EPS)) arr.push(f2)
  return arr
}

export { logspace }

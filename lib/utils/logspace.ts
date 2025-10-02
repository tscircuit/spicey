import { EPS } from "../constants/EPS"

function logspace(f1: number, f2: number, pointsPerDecade: number) {
  if (f1 <= 0 || f2 <= 0) throw new Error(".ac frequencies must be > 0")
  if (f2 < f1) [f1, f2] = [f2, f1]
  const decades = Math.log10(f2 / f1)
  const n = Math.max(1, Math.ceil(decades * pointsPerDecade))
  const arr: number[] = []
  for (let i = 0; i <= n; i++) {
    arr.push(f1 * Math.pow(10, i / pointsPerDecade))
  }
  const last = arr[arr.length - 1]
  if (last == null || last < f2 * (1 - EPS)) arr.push(f2)
  return arr
}

export { logspace }

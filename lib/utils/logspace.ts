import { EPS } from "../constants/EPS"

function logspace({
  startFrequencyHz,
  stopFrequencyHz,
  pointsPerInterval,
  intervalBase = 10,
}: {
  startFrequencyHz: number
  stopFrequencyHz: number
  pointsPerInterval: number
  intervalBase?: number
}) {
  if (startFrequencyHz <= 0 || stopFrequencyHz <= 0) {
    throw new Error(".ac frequencies must be > 0")
  }
  if (stopFrequencyHz < startFrequencyHz) {
    ;[startFrequencyHz, stopFrequencyHz] = [stopFrequencyHz, startFrequencyHz]
  }
  const intervals =
    Math.log(stopFrequencyHz / startFrequencyHz) / Math.log(intervalBase)
  const pointCount = Math.max(1, Math.floor(intervals * pointsPerInterval))
  const frequenciesHz: number[] = []
  for (let pointIndex = 0; pointIndex <= pointCount; pointIndex++) {
    frequenciesHz.push(
      startFrequencyHz * Math.pow(intervalBase, pointIndex / pointsPerInterval),
    )
  }
  const lastFrequencyHz = frequenciesHz.at(-1)
  if (
    lastFrequencyHz == null ||
    lastFrequencyHz < stopFrequencyHz * (1 - EPS)
  ) {
    frequenciesHz.push(stopFrequencyHz)
  }
  return frequenciesHz
}

export { logspace }

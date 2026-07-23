import type { ParsedCircuit } from "../parsing/parseNetlist"
import { calculateDcOperatingPoint } from "./simulateDCOperatingPoint"

const isDcSweepCoordinateInRange = ({
  dcSweepCoordinate,
  stop,
  step,
}: {
  dcSweepCoordinate: number
  stop: number
  step: number
}) => {
  const tolerance = Math.abs(step) * 1e-9
  return step > 0
    ? dcSweepCoordinate <= stop + tolerance
    : dcSweepCoordinate >= stop - tolerance
}

const getDcSweepCoordinates = ({
  start,
  stop,
  step,
}: {
  start: number
  stop: number
  step: number
}) => {
  if (step === 0) throw new Error(".dc step must not be zero")
  if ((stop - start) * step < 0) {
    throw new Error(".dc step must move from start toward stop")
  }

  const dcSweepCoordinates: number[] = []

  for (
    let dcSweepCoordinate = start;
    isDcSweepCoordinateInRange({ dcSweepCoordinate, stop, step });
    dcSweepCoordinate = start + dcSweepCoordinates.length * step
  ) {
    dcSweepCoordinates.push(dcSweepCoordinate)
    if (dcSweepCoordinates.length > 1_000_000) {
      throw new Error(".dc sweep exceeds 1,000,000 points")
    }
  }
  return dcSweepCoordinates
}

export const simulateDCSweep = (circuit: ParsedCircuit) => {
  const dcSweepAnalysis = circuit.analyses.dc
  if (!dcSweepAnalysis) return null

  const voltageSource = circuit.V.find(
    (simulationVoltageSource) =>
      simulationVoltageSource.name.toLowerCase() ===
      dcSweepAnalysis.sourceName.toLowerCase(),
  )
  const currentSource = circuit.I.find(
    (simulationCurrentSource) =>
      simulationCurrentSource.name.toLowerCase() ===
      dcSweepAnalysis.sourceName.toLowerCase(),
  )
  const dcSweepSource = voltageSource ?? currentSource
  if (!dcSweepSource) {
    throw new Error(`.dc source ${dcSweepAnalysis.sourceName} was not found`)
  }

  const originalDcSourceLevel = dcSweepSource.dc
  const dcSweepCoordinates = getDcSweepCoordinates(dcSweepAnalysis)
  const sweepUnit: "V" | "A" = voltageSource ? "V" : "A"
  const nodeVoltages: Record<string, number[]> = {}
  const elementCurrents: Record<string, number[]> = {}

  try {
    for (const dcSweepCoordinate of dcSweepCoordinates) {
      dcSweepSource.dc = dcSweepCoordinate
      const operatingPoint = calculateDcOperatingPoint(circuit)
      for (const [nodeName, voltage] of Object.entries(
        operatingPoint.nodeVoltages,
      )) {
        ;(nodeVoltages[nodeName] ||= []).push(voltage)
      }
      for (const [elementName, current] of Object.entries(
        operatingPoint.elementCurrents,
      )) {
        ;(elementCurrents[elementName] ||= []).push(current)
      }
    }
  } finally {
    dcSweepSource.dc = originalDcSourceLevel
  }

  return {
    sweepValues: dcSweepCoordinates,
    sweepUnit,
    nodeVoltages,
    elementCurrents,
  }
}

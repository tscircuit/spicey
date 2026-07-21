import type { ParsedCircuit } from "../parsing/parseNetlist"
import { calculateDcOperatingPoint } from "./simulateDCOperatingPoint"

const getSweepValues = ({
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

  const values: number[] = []
  const tolerance = Math.abs(step) * 1e-9
  const isInRange = (value: number) =>
    step > 0 ? value <= stop + tolerance : value >= stop - tolerance

  for (
    let value = start;
    isInRange(value);
    value = start + values.length * step
  ) {
    values.push(value)
    if (values.length > 1_000_000) {
      throw new Error(".dc sweep exceeds 1,000,000 points")
    }
  }
  return values
}

export const simulateDCSweep = (circuit: ParsedCircuit) => {
  const analysis = circuit.analyses.dc
  if (!analysis) return null

  const voltageSource = circuit.V.find(
    (source) => source.name.toLowerCase() === analysis.sourceName.toLowerCase(),
  )
  const currentSource = circuit.I.find(
    (source) => source.name.toLowerCase() === analysis.sourceName.toLowerCase(),
  )
  const source = voltageSource ?? currentSource
  if (!source) {
    throw new Error(`.dc source ${analysis.sourceName} was not found`)
  }

  const originalDcValue = source.dc
  const sweepValues = getSweepValues(analysis)
  const nodeVoltages: Record<string, number[]> = {}
  const elementCurrents: Record<string, number[]> = {}

  try {
    for (const sweepValue of sweepValues) {
      source.dc = sweepValue
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
    source.dc = originalDcValue
  }

  return {
    sweepValues,
    sweepUnit: voltageSource ? ("V" as const) : ("A" as const),
    nodeVoltages,
    elementCurrents,
  }
}

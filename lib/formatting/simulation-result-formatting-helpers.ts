import type { simulate } from "../analysis/simulate"
import { Complex } from "../math/Complex"

export type SpiceySimulation = ReturnType<typeof simulate>

type NormalizedSpiceVector = string

type ProbeMetadata = {
  simulation_voltage_probe_id?: string
  simulation_current_probe_id?: string
  name?: string
  spice_vector: string
}

type ProbeMetadataBySpiceVector = Map<NormalizedSpiceVector, ProbeMetadata>

export interface CircuitJsonFormattingContext {
  simulation: SpiceySimulation
  simulationExperimentId: string
  voltageProbeMetadataBySpiceVector: ProbeMetadataBySpiceVector
  currentProbeMetadataBySpiceVector: ProbeMetadataBySpiceVector
}

export const normalizeSpiceVector = (
  spiceVector: string,
): NormalizedSpiceVector => spiceVector.toLowerCase().replace(/\s/g, "")

export const createCircuitJsonFormattingContext = ({
  simulation,
  spiceString,
  simulationExperimentId,
}: {
  simulation: SpiceySimulation
  spiceString: string
  simulationExperimentId: string
}): CircuitJsonFormattingContext => {
  const voltageProbeMetadataBySpiceVector: ProbeMetadataBySpiceVector =
    new Map()
  const currentProbeMetadataBySpiceVector: ProbeMetadataBySpiceVector =
    new Map()

  for (const spiceLine of spiceString.split(/\r?\n/)) {
    const voltageProbeMatch = spiceLine.match(
      /^\s*\*\s*tscircuit_probe\s+(.+)\s*$/,
    )
    const currentProbeMatch = spiceLine.match(
      /^\s*\*\s*tscircuit_current_probe\s+(.+)\s*$/,
    )
    const serializedProbeMetadata =
      voltageProbeMatch?.[1] ?? currentProbeMatch?.[1]
    if (!serializedProbeMetadata) continue

    try {
      const parsedProbeMetadata: unknown = JSON.parse(serializedProbeMetadata)
      if (
        typeof parsedProbeMetadata !== "object" ||
        parsedProbeMetadata === null ||
        !("spice_vector" in parsedProbeMetadata) ||
        typeof parsedProbeMetadata.spice_vector !== "string"
      ) {
        continue
      }

      const probeMetadata: ProbeMetadata = {
        spice_vector: parsedProbeMetadata.spice_vector,
        name:
          "name" in parsedProbeMetadata &&
          typeof parsedProbeMetadata.name === "string"
            ? parsedProbeMetadata.name
            : undefined,
        simulation_voltage_probe_id:
          "simulation_voltage_probe_id" in parsedProbeMetadata &&
          typeof parsedProbeMetadata.simulation_voltage_probe_id === "string"
            ? parsedProbeMetadata.simulation_voltage_probe_id
            : undefined,
        simulation_current_probe_id:
          "simulation_current_probe_id" in parsedProbeMetadata &&
          typeof parsedProbeMetadata.simulation_current_probe_id === "string"
            ? parsedProbeMetadata.simulation_current_probe_id
            : undefined,
      }
      const probeMetadataBySpiceVector = voltageProbeMatch
        ? voltageProbeMetadataBySpiceVector
        : currentProbeMetadataBySpiceVector
      probeMetadataBySpiceVector.set(
        normalizeSpiceVector(parsedProbeMetadata.spice_vector),
        probeMetadata,
      )
    } catch {}
  }

  return {
    simulation,
    simulationExperimentId,
    voltageProbeMetadataBySpiceVector,
    currentProbeMetadataBySpiceVector,
  }
}

export const getProbeMetadata = ({
  formattingContext,
  spiceVector,
}: {
  formattingContext: CircuitJsonFormattingContext
  spiceVector: string
}): ProbeMetadata | undefined => {
  const probeMetadataBySpiceVector = spiceVector
    .trim()
    .toLowerCase()
    .startsWith("v(")
    ? formattingContext.voltageProbeMetadataBySpiceVector
    : formattingContext.currentProbeMetadataBySpiceVector
  return probeMetadataBySpiceVector.get(normalizeSpiceVector(spiceVector))
}

export const getCaseInsensitiveRecordEntry = <Measurement>(
  measurementByName: Record<string, Measurement>,
  requestedName: string,
): Measurement | undefined => {
  const matchingName = Object.keys(measurementByName).find(
    (measurementName) =>
      measurementName.toLowerCase() === requestedName.toLowerCase(),
  )
  return matchingName ? measurementByName[matchingName] : undefined
}

const getVoltageNodeNames = (spiceVector: string) => {
  const voltageVectorMatch = spiceVector.match(/^v\(([^)]+)\)$/i)
  if (!voltageVectorMatch?.[1]) return null
  const [positiveNodeName, referenceNodeName] = voltageVectorMatch[1]
    .split(",")
    .map((nodeName) => nodeName.trim())
  return positiveNodeName ? { positiveNodeName, referenceNodeName } : null
}

export const getVoltageName = (spiceVector: string) => {
  const voltageNodeNames = getVoltageNodeNames(spiceVector)
  if (!voltageNodeNames) return spiceVector
  return voltageNodeNames.referenceNodeName
    ? `${voltageNodeNames.positiveNodeName}-${voltageNodeNames.referenceNodeName}`
    : voltageNodeNames.positiveNodeName
}

export const getCurrentName = (spiceVector: string) => {
  const currentVectorMatch = spiceVector.match(/^i\(([^)]+)\)$/i)
  return currentVectorMatch?.[1]?.trim() ?? spiceVector
}

export const subtractNumberArrays = (
  positiveMeasurements: number[],
  negativeMeasurements: number[],
) =>
  positiveMeasurements.map(
    (positiveMeasurement, sampleIndex) =>
      positiveMeasurement - (negativeMeasurements[sampleIndex] ?? 0),
  )

export const subtractComplexArrays = (
  positiveMeasurements: Complex[],
  negativeMeasurements: Complex[],
) =>
  positiveMeasurements.map((positiveMeasurement, sampleIndex) =>
    positiveMeasurement.sub(
      negativeMeasurements[sampleIndex] ?? Complex.from(0, 0),
    ),
  )

export const getVoltageMeasurement = <VoltageMeasurement>({
  spiceVector,
  voltageMeasurementByNodeName,
  subtractMeasurements,
}: {
  spiceVector: string
  voltageMeasurementByNodeName: Record<string, VoltageMeasurement>
  subtractMeasurements: (
    positiveMeasurement: VoltageMeasurement,
    negativeMeasurement: VoltageMeasurement,
  ) => VoltageMeasurement
}): VoltageMeasurement | undefined => {
  const voltageNodeNames = getVoltageNodeNames(spiceVector)
  if (!voltageNodeNames) return undefined
  const positiveMeasurement = getCaseInsensitiveRecordEntry(
    voltageMeasurementByNodeName,
    voltageNodeNames.positiveNodeName,
  )
  if (positiveMeasurement === undefined) return undefined
  if (!voltageNodeNames.referenceNodeName) return positiveMeasurement
  const negativeMeasurement = getCaseInsensitiveRecordEntry(
    voltageMeasurementByNodeName,
    voltageNodeNames.referenceNodeName,
  )
  return negativeMeasurement === undefined
    ? undefined
    : subtractMeasurements(positiveMeasurement, negativeMeasurement)
}

export const getAnalysisVectors = ({
  formattingContext,
  analysisType,
}: {
  formattingContext: CircuitJsonFormattingContext
  analysisType: "tran" | "op" | "dc" | "ac"
}) => formattingContext.simulation.circuit.probeVectors[analysisType]

export const getSimulationProbeId = ({
  probeMetadata,
  graphIndex,
  graphName,
  probeType,
}: {
  probeMetadata: ProbeMetadata | undefined
  graphIndex: number
  graphName: string
  probeType: "voltage" | "current"
}) =>
  (probeType === "voltage"
    ? probeMetadata?.simulation_voltage_probe_id
    : probeMetadata?.simulation_current_probe_id) ??
  `simulation_${probeType}_probe_${graphIndex}_${graphName}`

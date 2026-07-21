import type {
  SimulationAcSweepCurrentGraph,
  SimulationAcSweepVoltageGraph,
  SimulationDcOperatingPointCurrent,
  SimulationDcOperatingPointVoltage,
  SimulationDcSweepCurrentGraph,
  SimulationDcSweepVoltageGraph,
  SimulationTransientCurrentGraph,
  SimulationTransientVoltageGraph,
} from "circuit-json"
import type { simulate } from "../analysis/simulate"
import type { Complex } from "../math/Complex"

type SpiceySimulation = ReturnType<typeof simulate>
type SimulationResultCircuitElement =
  | SimulationTransientVoltageGraph
  | SimulationTransientCurrentGraph
  | SimulationDcOperatingPointVoltage
  | SimulationDcOperatingPointCurrent
  | SimulationDcSweepVoltageGraph
  | SimulationDcSweepCurrentGraph
  | SimulationAcSweepVoltageGraph
  | SimulationAcSweepCurrentGraph

type ProbeMetadata = {
  simulation_voltage_probe_id?: string
  simulation_current_probe_id?: string
  name?: string
  spice_vector: string
}

const normalizeSpiceVector = (spiceVector: string) =>
  spiceVector.toLowerCase().replace(/\s/g, "")

const getProbeMetadata = (spiceString: string) => {
  const voltageMetadata = new Map<string, ProbeMetadata>()
  const currentMetadata = new Map<string, ProbeMetadata>()

  for (const line of spiceString.split(/\r?\n/)) {
    const voltageMatch = line.match(/^\s*\*\s*tscircuit_probe\s+(.+)\s*$/)
    const currentMatch = line.match(
      /^\s*\*\s*tscircuit_current_probe\s+(.+)\s*$/,
    )
    const match = voltageMatch ?? currentMatch
    if (!match?.[1]) continue

    try {
      const parsed = JSON.parse(match[1]) as Partial<ProbeMetadata>
      if (typeof parsed.spice_vector !== "string") continue
      const metadata: ProbeMetadata = {
        spice_vector: parsed.spice_vector,
        name: typeof parsed.name === "string" ? parsed.name : undefined,
        simulation_voltage_probe_id:
          typeof parsed.simulation_voltage_probe_id === "string"
            ? parsed.simulation_voltage_probe_id
            : undefined,
        simulation_current_probe_id:
          typeof parsed.simulation_current_probe_id === "string"
            ? parsed.simulation_current_probe_id
            : undefined,
      }
      const metadataMap = voltageMatch ? voltageMetadata : currentMetadata
      metadataMap.set(normalizeSpiceVector(parsed.spice_vector), metadata)
    } catch {}
  }

  return { voltageMetadata, currentMetadata }
}

const getRecordValue = <RecordValue>(
  record: Record<string, RecordValue>,
  requestedName: string,
) => {
  const matchingName = Object.keys(record).find(
    (name) => name.toLowerCase() === requestedName.toLowerCase(),
  )
  return matchingName ? record[matchingName] : undefined
}

const getVoltageNodeNames = (spiceVector: string) => {
  const match = spiceVector.match(/^v\(([^)]+)\)$/i)
  if (!match?.[1]) return null
  const [positiveNodeName, referenceNodeName] = match[1]
    .split(",")
    .map((name) => name.trim())
  return positiveNodeName ? { positiveNodeName, referenceNodeName } : null
}

const getVoltageName = (spiceVector: string) => {
  const nodeNames = getVoltageNodeNames(spiceVector)
  if (!nodeNames) return spiceVector
  return nodeNames.referenceNodeName
    ? `${nodeNames.positiveNodeName}-${nodeNames.referenceNodeName}`
    : nodeNames.positiveNodeName
}

const getCurrentName = (spiceVector: string) => {
  const match = spiceVector.match(/^i\(([^)]+)\)$/i)
  return match?.[1]?.trim() ?? spiceVector
}

const subtractNumberArrays = (
  positiveValues: number[],
  negativeValues: number[],
) =>
  positiveValues.map(
    (positiveValue, index) => positiveValue - (negativeValues[index] ?? 0),
  )

const subtractComplexArrays = (
  positiveValues: Complex[],
  negativeValues: Complex[],
) =>
  positiveValues.map((positiveValue, index) =>
    positiveValue.sub(negativeValues[index] ?? positiveValue.clone()),
  )

const getVoltageValue = <VoltageValue>({
  spiceVector,
  nodeVoltages,
  subtractValues,
}: {
  spiceVector: string
  nodeVoltages: Record<string, VoltageValue>
  subtractValues: (
    positiveValue: VoltageValue,
    negativeValue: VoltageValue,
  ) => VoltageValue
}) => {
  const nodeNames = getVoltageNodeNames(spiceVector)
  if (!nodeNames) return undefined
  const positiveValue = getRecordValue(nodeVoltages, nodeNames.positiveNodeName)
  if (positiveValue === undefined) return undefined
  if (!nodeNames.referenceNodeName) return positiveValue
  const negativeValue = getRecordValue(
    nodeVoltages,
    nodeNames.referenceNodeName,
  )
  return negativeValue === undefined
    ? undefined
    : subtractValues(positiveValue, negativeValue)
}

const getAnalysisVectors = ({
  simulation,
  analysisType,
}: {
  simulation: SpiceySimulation
  analysisType: "tran" | "op" | "dc" | "ac"
}) => simulation.circuit.probeVectors[analysisType]

const getProbeId = ({
  metadata,
  graphIndex,
  graphName,
  probeType,
}: {
  metadata: ProbeMetadata | undefined
  graphIndex: number
  graphName: string
  probeType: "voltage" | "current"
}) =>
  (probeType === "voltage"
    ? metadata?.simulation_voltage_probe_id
    : metadata?.simulation_current_probe_id) ??
  `simulation_${probeType}_probe_${graphIndex}_${graphName}`

export const spiceySimulationToCircuitJson = ({
  simulation,
  spiceString,
  simulationExperimentId,
}: {
  simulation: SpiceySimulation
  spiceString: string
  simulationExperimentId: string
}): SimulationResultCircuitElement[] => {
  const { voltageMetadata, currentMetadata } = getProbeMetadata(spiceString)
  const circuitJson: SimulationResultCircuitElement[] = []

  const getMetadata = (spiceVector: string) =>
    spiceVector.trim().toLowerCase().startsWith("v(")
      ? voltageMetadata.get(normalizeSpiceVector(spiceVector))
      : currentMetadata.get(normalizeSpiceVector(spiceVector))

  if (simulation.tran && simulation.circuit.analyses.tran) {
    const { times, nodeVoltages, elementCurrents } = simulation.tran
    const transientAnalysis = simulation.circuit.analyses.tran
    const vectors = getAnalysisVectors({ simulation, analysisType: "tran" })
    for (const [graphIndex, spiceVector] of vectors.entries()) {
      const metadata = getMetadata(spiceVector)
      if (spiceVector.toLowerCase().startsWith("v(")) {
        const voltageLevels = getVoltageValue({
          spiceVector,
          nodeVoltages,
          subtractValues: subtractNumberArrays,
        })
        if (!voltageLevels) continue
        const graphName = metadata?.name ?? getVoltageName(spiceVector)
        circuitJson.push({
          type: "simulation_transient_voltage_graph",
          simulation_transient_voltage_graph_id: `simulation_transient_voltage_graph_${graphIndex}_${graphName}`,
          simulation_experiment_id: simulationExperimentId,
          timestamps_ms: times.map((time) => time * 1000),
          voltage_levels: voltageLevels,
          time_per_step: transientAnalysis.dt * 1000,
          start_time_ms: 0,
          end_time_ms: transientAnalysis.tstop * 1000,
          name: graphName,
        })
      } else {
        const currentName = getCurrentName(spiceVector)
        const currentLevels = getRecordValue(elementCurrents, currentName)
        if (!currentLevels) continue
        const graphName = metadata?.name ?? currentName
        circuitJson.push({
          type: "simulation_transient_current_graph",
          simulation_transient_current_graph_id: `simulation_transient_current_graph_${graphIndex}_${graphName}`,
          simulation_experiment_id: simulationExperimentId,
          timestamps_ms: times.map((time) => time * 1000),
          current_levels: currentLevels,
          time_per_step: transientAnalysis.dt * 1000,
          start_time_ms: 0,
          end_time_ms: transientAnalysis.tstop * 1000,
          name: graphName,
        })
      }
    }
  }

  if (simulation.op) {
    const vectors = getAnalysisVectors({ simulation, analysisType: "op" })
    for (const [graphIndex, spiceVector] of vectors.entries()) {
      const metadata = getMetadata(spiceVector)
      if (spiceVector.toLowerCase().startsWith("v(")) {
        const voltage = getVoltageValue({
          spiceVector,
          nodeVoltages: simulation.op.nodeVoltages,
          subtractValues: (positive, negative) => positive - negative,
        })
        if (voltage === undefined) continue
        const graphName = metadata?.name ?? getVoltageName(spiceVector)
        const probeId = getProbeId({
          metadata,
          graphIndex,
          graphName,
          probeType: "voltage",
        })
        circuitJson.push({
          type: "simulation_dc_operating_point_voltage",
          simulation_dc_operating_point_voltage_id: `simulation_dc_operating_point_voltage_${probeId}`,
          simulation_experiment_id: simulationExperimentId,
          simulation_voltage_probe_id: probeId,
          voltage,
          name: graphName,
        })
      } else {
        const currentName = getCurrentName(spiceVector)
        const current = getRecordValue(
          simulation.op.elementCurrents,
          currentName,
        )
        if (current === undefined) continue
        const graphName = metadata?.name ?? currentName
        const probeId = getProbeId({
          metadata,
          graphIndex,
          graphName,
          probeType: "current",
        })
        circuitJson.push({
          type: "simulation_dc_operating_point_current",
          simulation_dc_operating_point_current_id: `simulation_dc_operating_point_current_${probeId}`,
          simulation_experiment_id: simulationExperimentId,
          simulation_current_probe_id: probeId,
          current,
          name: graphName,
        })
      }
    }
  }

  if (simulation.dc) {
    const vectors = getAnalysisVectors({ simulation, analysisType: "dc" })
    for (const [graphIndex, spiceVector] of vectors.entries()) {
      const metadata = getMetadata(spiceVector)
      if (spiceVector.toLowerCase().startsWith("v(")) {
        const voltageLevels = getVoltageValue({
          spiceVector,
          nodeVoltages: simulation.dc.nodeVoltages,
          subtractValues: subtractNumberArrays,
        })
        if (!voltageLevels) continue
        const graphName = metadata?.name ?? getVoltageName(spiceVector)
        const probeId = getProbeId({
          metadata,
          graphIndex,
          graphName,
          probeType: "voltage",
        })
        circuitJson.push({
          type: "simulation_dc_sweep_voltage_graph",
          simulation_dc_sweep_voltage_graph_id: `simulation_dc_sweep_voltage_graph_${probeId}`,
          simulation_experiment_id: simulationExperimentId,
          simulation_voltage_probe_id: probeId,
          sweep_values: simulation.dc.sweepValues,
          sweep_unit: simulation.dc.sweepUnit,
          voltage_levels: voltageLevels,
          name: graphName,
        })
      } else {
        const currentName = getCurrentName(spiceVector)
        const currentLevels = getRecordValue(
          simulation.dc.elementCurrents,
          currentName,
        )
        if (!currentLevels) continue
        const graphName = metadata?.name ?? currentName
        const probeId = getProbeId({
          metadata,
          graphIndex,
          graphName,
          probeType: "current",
        })
        circuitJson.push({
          type: "simulation_dc_sweep_current_graph",
          simulation_dc_sweep_current_graph_id: `simulation_dc_sweep_current_graph_${probeId}`,
          simulation_experiment_id: simulationExperimentId,
          simulation_current_probe_id: probeId,
          sweep_values: simulation.dc.sweepValues,
          sweep_unit: simulation.dc.sweepUnit,
          current_levels: currentLevels,
          name: graphName,
        })
      }
    }
  }

  if (simulation.ac) {
    const vectors = getAnalysisVectors({ simulation, analysisType: "ac" })
    for (const [graphIndex, spiceVector] of vectors.entries()) {
      const metadata = getMetadata(spiceVector)
      if (spiceVector.toLowerCase().startsWith("v(")) {
        const complexVoltages = getVoltageValue({
          spiceVector,
          nodeVoltages: simulation.ac.nodeVoltages,
          subtractValues: subtractComplexArrays,
        })
        if (!complexVoltages) continue
        const graphName = metadata?.name ?? getVoltageName(spiceVector)
        const probeId = getProbeId({
          metadata,
          graphIndex,
          graphName,
          probeType: "voltage",
        })
        circuitJson.push({
          type: "simulation_ac_sweep_voltage_graph",
          simulation_ac_sweep_voltage_graph_id: `simulation_ac_sweep_voltage_graph_${probeId}`,
          simulation_experiment_id: simulationExperimentId,
          simulation_voltage_probe_id: probeId,
          frequencies_hz: simulation.ac.freqs,
          complex_voltages: complexVoltages.map(({ re, im }) => ({ re, im })),
          name: graphName,
        })
      } else {
        const currentName = getCurrentName(spiceVector)
        const complexCurrents = getRecordValue(
          simulation.ac.elementCurrents,
          currentName,
        )
        if (!complexCurrents) continue
        const graphName = metadata?.name ?? currentName
        const probeId = getProbeId({
          metadata,
          graphIndex,
          graphName,
          probeType: "current",
        })
        circuitJson.push({
          type: "simulation_ac_sweep_current_graph",
          simulation_ac_sweep_current_graph_id: `simulation_ac_sweep_current_graph_${probeId}`,
          simulation_experiment_id: simulationExperimentId,
          simulation_current_probe_id: probeId,
          frequencies_hz: simulation.ac.freqs,
          complex_currents: complexCurrents.map(({ re, im }) => ({ re, im })),
          name: graphName,
        })
      }
    }
  }

  return circuitJson
}

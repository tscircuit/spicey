import type {
  SimulationTransientCurrentGraph,
  SimulationTransientVoltageGraph,
} from "circuit-json"
import {
  getAnalysisVectors,
  getCaseInsensitiveRecordEntry,
  getCurrentName,
  getProbeMetadata,
  getVoltageMeasurement,
  getVoltageName,
  subtractNumberArrays,
  type CircuitJsonFormattingContext,
} from "./simulation-result-formatting-helpers"

export const formatTransientToCircuitJson = (
  formattingContext: CircuitJsonFormattingContext,
): Array<SimulationTransientVoltageGraph | SimulationTransientCurrentGraph> => {
  const { simulation, simulationExperimentId } = formattingContext
  if (!simulation.tran || !simulation.circuit.analyses.tran) return []

  const { times, nodeVoltages, elementCurrents } = simulation.tran
  const transientAnalysis = simulation.circuit.analyses.tran
  const simulationGraphs: Array<
    SimulationTransientVoltageGraph | SimulationTransientCurrentGraph
  > = []
  const requestedSpiceVectors = getAnalysisVectors({
    formattingContext,
    analysisType: "tran",
  })
  const transientSpiceVectors =
    requestedSpiceVectors.length > 0
      ? requestedSpiceVectors
      : Object.keys(nodeVoltages).map((nodeName) => `V(${nodeName})`)

  for (const [graphIndex, spiceVector] of transientSpiceVectors.entries()) {
    const probeMetadata = getProbeMetadata({
      formattingContext,
      spiceVector,
    })
    if (spiceVector.toLowerCase().startsWith("v(")) {
      const voltageLevels = getVoltageMeasurement({
        spiceVector,
        voltageMeasurementByNodeName: nodeVoltages,
        subtractMeasurements: subtractNumberArrays,
      })
      if (!voltageLevels) continue
      const graphName = probeMetadata?.name ?? getVoltageName(spiceVector)
      simulationGraphs.push({
        type: "simulation_transient_voltage_graph",
        simulation_transient_voltage_graph_id: `simulation_transient_voltage_graph_${graphIndex}_${graphName}`,
        simulation_experiment_id: simulationExperimentId,
        timestamps_ms: times.map((timeSeconds) => timeSeconds * 1000),
        voltage_levels: voltageLevels,
        time_per_step: transientAnalysis.dt * 1000,
        start_time_ms: 0,
        end_time_ms: transientAnalysis.tstop * 1000,
        name: graphName,
      })
      continue
    }

    const currentName = getCurrentName(spiceVector)
    const currentLevels = getCaseInsensitiveRecordEntry(
      elementCurrents,
      currentName,
    )
    if (!currentLevels) continue
    const graphName = probeMetadata?.name ?? currentName
    simulationGraphs.push({
      type: "simulation_transient_current_graph",
      simulation_transient_current_graph_id: `simulation_transient_current_graph_${graphIndex}_${graphName}`,
      simulation_experiment_id: simulationExperimentId,
      timestamps_ms: times.map((timeSeconds) => timeSeconds * 1000),
      current_levels: currentLevels,
      time_per_step: transientAnalysis.dt * 1000,
      start_time_ms: 0,
      end_time_ms: transientAnalysis.tstop * 1000,
      name: graphName,
    })
  }

  return simulationGraphs
}

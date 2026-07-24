import type {
  SimulationDcSweepCurrentGraph,
  SimulationDcSweepVoltageGraph,
} from "circuit-json"
import {
  getAnalysisVectors,
  getCaseInsensitiveRecordEntry,
  getCurrentName,
  getProbeMetadata,
  getSimulationProbeId,
  getVoltageMeasurement,
  getVoltageName,
  subtractNumberArrays,
  type CircuitJsonFormattingContext,
} from "./simulation-result-formatting-helpers"

export const formatDcSweepToCircuitJson = (
  formattingContext: CircuitJsonFormattingContext,
): Array<SimulationDcSweepVoltageGraph | SimulationDcSweepCurrentGraph> => {
  const { simulation, simulationExperimentId } = formattingContext
  if (!simulation.dc) return []

  const simulationGraphs: Array<
    SimulationDcSweepVoltageGraph | SimulationDcSweepCurrentGraph
  > = []
  for (const [graphIndex, spiceVector] of getAnalysisVectors({
    formattingContext,
    analysisType: "dc",
  }).entries()) {
    const probeMetadata = getProbeMetadata({
      formattingContext,
      spiceVector,
    })
    if (spiceVector.toLowerCase().startsWith("v(")) {
      const voltageLevels = getVoltageMeasurement({
        spiceVector,
        voltageMeasurementByNodeName: simulation.dc.nodeVoltages,
        subtractMeasurements: subtractNumberArrays,
      })
      if (!voltageLevels) continue
      const graphName = probeMetadata?.name ?? getVoltageName(spiceVector)
      const simulationVoltageProbeId = getSimulationProbeId({
        probeMetadata,
        graphIndex,
        graphName,
        probeType: "voltage",
      })
      simulationGraphs.push({
        type: "simulation_dc_sweep_voltage_graph",
        simulation_dc_sweep_voltage_graph_id: `simulation_dc_sweep_voltage_graph_${simulationVoltageProbeId}`,
        simulation_experiment_id: simulationExperimentId,
        simulation_voltage_probe_id: simulationVoltageProbeId,
        sweep_values: simulation.dc.sweepValues,
        sweep_unit: simulation.dc.sweepUnit,
        voltage_levels: voltageLevels,
        name: graphName,
      })
      continue
    }

    const currentName = getCurrentName(spiceVector)
    const currentLevels = getCaseInsensitiveRecordEntry(
      simulation.dc.elementCurrents,
      currentName,
    )
    if (!currentLevels) continue
    const graphName = probeMetadata?.name ?? currentName
    const simulationCurrentProbeId = getSimulationProbeId({
      probeMetadata,
      graphIndex,
      graphName,
      probeType: "current",
    })
    simulationGraphs.push({
      type: "simulation_dc_sweep_current_graph",
      simulation_dc_sweep_current_graph_id: `simulation_dc_sweep_current_graph_${simulationCurrentProbeId}`,
      simulation_experiment_id: simulationExperimentId,
      simulation_current_probe_id: simulationCurrentProbeId,
      sweep_values: simulation.dc.sweepValues,
      sweep_unit: simulation.dc.sweepUnit,
      current_levels: currentLevels,
      name: graphName,
    })
  }

  return simulationGraphs
}

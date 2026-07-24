import type {
  SimulationAcSweepCurrentGraph,
  SimulationAcSweepVoltageGraph,
} from "circuit-json"
import {
  getAnalysisVectors,
  getCaseInsensitiveRecordEntry,
  getCurrentName,
  getProbeMetadata,
  getSimulationProbeId,
  getVoltageMeasurement,
  getVoltageName,
  subtractComplexArrays,
  type CircuitJsonFormattingContext,
} from "./simulation-result-formatting-helpers"

export const formatAcSweepToCircuitJson = (
  formattingContext: CircuitJsonFormattingContext,
): Array<SimulationAcSweepVoltageGraph | SimulationAcSweepCurrentGraph> => {
  const { simulation, simulationExperimentId } = formattingContext
  if (!simulation.ac) return []

  const simulationGraphs: Array<
    SimulationAcSweepVoltageGraph | SimulationAcSweepCurrentGraph
  > = []
  for (const [graphIndex, spiceVector] of getAnalysisVectors({
    formattingContext,
    analysisType: "ac",
  }).entries()) {
    const probeMetadata = getProbeMetadata({
      formattingContext,
      spiceVector,
    })
    if (spiceVector.toLowerCase().startsWith("v(")) {
      const complexVoltages = getVoltageMeasurement({
        spiceVector,
        voltageMeasurementByNodeName: simulation.ac.nodeVoltages,
        subtractMeasurements: subtractComplexArrays,
      })
      if (!complexVoltages) continue
      const graphName = probeMetadata?.name ?? getVoltageName(spiceVector)
      const simulationVoltageProbeId = getSimulationProbeId({
        probeMetadata,
        graphIndex,
        graphName,
        probeType: "voltage",
      })
      simulationGraphs.push({
        type: "simulation_ac_sweep_voltage_graph",
        simulation_ac_sweep_voltage_graph_id: `simulation_ac_sweep_voltage_graph_${simulationVoltageProbeId}`,
        simulation_experiment_id: simulationExperimentId,
        simulation_voltage_probe_id: simulationVoltageProbeId,
        frequencies_hz: simulation.ac.freqs,
        complex_voltages: complexVoltages.map(({ re, im }) => ({ re, im })),
        name: graphName,
      })
      continue
    }

    const currentName = getCurrentName(spiceVector)
    const complexCurrents = getCaseInsensitiveRecordEntry(
      simulation.ac.elementCurrents,
      currentName,
    )
    if (!complexCurrents) continue
    const graphName = probeMetadata?.name ?? currentName
    const simulationCurrentProbeId = getSimulationProbeId({
      probeMetadata,
      graphIndex,
      graphName,
      probeType: "current",
    })
    simulationGraphs.push({
      type: "simulation_ac_sweep_current_graph",
      simulation_ac_sweep_current_graph_id: `simulation_ac_sweep_current_graph_${simulationCurrentProbeId}`,
      simulation_experiment_id: simulationExperimentId,
      simulation_current_probe_id: simulationCurrentProbeId,
      frequencies_hz: simulation.ac.freqs,
      complex_currents: complexCurrents.map(({ re, im }) => ({ re, im })),
      name: graphName,
    })
  }

  return simulationGraphs
}

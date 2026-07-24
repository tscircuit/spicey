import type {
  SimulationDcOperatingPointCurrent,
  SimulationDcOperatingPointVoltage,
} from "circuit-json"
import {
  getAnalysisVectors,
  getCaseInsensitiveRecordEntry,
  getCurrentName,
  getProbeMetadata,
  getSimulationProbeId,
  getVoltageMeasurement,
  getVoltageName,
  type CircuitJsonFormattingContext,
} from "./simulation-result-formatting-helpers"

export const formatDcOperatingPointToCircuitJson = (
  formattingContext: CircuitJsonFormattingContext,
): Array<
  SimulationDcOperatingPointVoltage | SimulationDcOperatingPointCurrent
> => {
  const { simulation, simulationExperimentId } = formattingContext
  if (!simulation.op) return []

  const simulationResults: Array<
    SimulationDcOperatingPointVoltage | SimulationDcOperatingPointCurrent
  > = []
  for (const [resultIndex, spiceVector] of getAnalysisVectors({
    formattingContext,
    analysisType: "op",
  }).entries()) {
    const probeMetadata = getProbeMetadata({
      formattingContext,
      spiceVector,
    })
    if (spiceVector.toLowerCase().startsWith("v(")) {
      const voltage = getVoltageMeasurement({
        spiceVector,
        voltageMeasurementByNodeName: simulation.op.nodeVoltages,
        subtractMeasurements: (positiveVoltage, negativeVoltage) =>
          positiveVoltage - negativeVoltage,
      })
      if (voltage === undefined) continue
      const graphName = probeMetadata?.name ?? getVoltageName(spiceVector)
      const simulationVoltageProbeId = getSimulationProbeId({
        probeMetadata,
        graphIndex: resultIndex,
        graphName,
        probeType: "voltage",
      })
      simulationResults.push({
        type: "simulation_dc_operating_point_voltage",
        simulation_dc_operating_point_voltage_id: `simulation_dc_operating_point_voltage_${simulationVoltageProbeId}`,
        simulation_experiment_id: simulationExperimentId,
        simulation_voltage_probe_id: simulationVoltageProbeId,
        voltage,
        name: graphName,
      })
      continue
    }

    const currentName = getCurrentName(spiceVector)
    const current = getCaseInsensitiveRecordEntry(
      simulation.op.elementCurrents,
      currentName,
    )
    if (current === undefined) continue
    const graphName = probeMetadata?.name ?? currentName
    const simulationCurrentProbeId = getSimulationProbeId({
      probeMetadata,
      graphIndex: resultIndex,
      graphName,
      probeType: "current",
    })
    simulationResults.push({
      type: "simulation_dc_operating_point_current",
      simulation_dc_operating_point_current_id: `simulation_dc_operating_point_current_${simulationCurrentProbeId}`,
      simulation_experiment_id: simulationExperimentId,
      simulation_current_probe_id: simulationCurrentProbeId,
      current,
      name: graphName,
    })
  }

  return simulationResults
}

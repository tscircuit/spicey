import type {
  SimulationAnalysisResult,
  SimulationExperiment,
} from "circuit-json"
import {
  type AcSweepView,
  convertCircuitJsonToSimulationGraphSvg,
} from "circuit-to-svg"

export const renderAnalysisGraphSvg = ({
  simulationResultCircuitJson,
  simulationExperiment,
  acSweepView = "magnitude",
}: {
  simulationResultCircuitJson: SimulationAnalysisResult[]
  simulationExperiment: SimulationExperiment
  acSweepView?: AcSweepView
}) =>
  convertCircuitJsonToSimulationGraphSvg({
    circuitJson: [simulationExperiment, ...simulationResultCircuitJson],
    simulation_experiment_id: simulationExperiment.simulation_experiment_id,
    ac_sweep_view: acSweepView,
  })

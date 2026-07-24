import { expect, test } from "bun:test"
import { simulateToCircuitJson } from "lib/index"
import { renderAnalysisGraphSvg } from "../fixtures/render-analysis-graph-svg"

test("simulates a voltage-source DC sweep", () => {
  const spiceString = `
V1 in 0 DC 0
R1 in out 1k
R2 out 0 1k
.PRINT DC V(out) I(V1)
.dc V1 0 2 1
.end
`

  const circuitJson = simulateToCircuitJson({
    spiceString,
    simulationExperimentId: "simulation_experiment_0",
  })

  expect(circuitJson).toMatchObject([
    {
      type: "simulation_dc_sweep_voltage_graph",
      sweep_values: [0, 1, 2],
      sweep_unit: "V",
      voltage_levels: [0, 0.5, 1],
    },
    {
      type: "simulation_dc_sweep_current_graph",
      sweep_values: [0, 1, 2],
      sweep_unit: "V",
      current_levels: [0, -0.0005, -0.001],
    },
  ])

  const svg = renderAnalysisGraphSvg({
    simulationResultCircuitJson: circuitJson,
    simulationExperiment: {
      type: "simulation_experiment",
      simulation_experiment_id: "simulation_experiment_0",
      name: "Spicey Voltage Source DC Sweep",
      experiment_type: "spice_dc_sweep",
      dc_sweep_voltage_source_id: "source_component_v1",
      dc_sweep_start: 0,
      dc_sweep_stop: 2,
      dc_sweep_step: 1,
      dc_sweep_unit: "V",
    },
  })
  expect(svg).toContain(">DC Sweep (V)</text>")
  expect(svg).toMatchSvgSnapshot(
    import.meta.path,
    "spicey-voltage-source-dc-sweep",
  )
})

test("simulates a current-source DC sweep", () => {
  const spiceString = `
I1 out 0 DC 0
R1 out 0 1k
.PRINT DC V(out) I(I1)
.dc I1 0 2m 1m
.end
`

  const circuitJson = simulateToCircuitJson({
    spiceString,
    simulationExperimentId: "simulation_experiment_0",
  })

  expect(circuitJson).toMatchObject([
    {
      type: "simulation_dc_sweep_voltage_graph",
      sweep_values: [0, 0.001, 0.002],
      sweep_unit: "A",
      voltage_levels: [0, -1, -2],
    },
    {
      type: "simulation_dc_sweep_current_graph",
      sweep_values: [0, 0.001, 0.002],
      sweep_unit: "A",
      current_levels: [0, 0.001, 0.002],
    },
  ])

  const svg = renderAnalysisGraphSvg({
    simulationResultCircuitJson: circuitJson,
    simulationExperiment: {
      type: "simulation_experiment",
      simulation_experiment_id: "simulation_experiment_0",
      name: "Spicey Current Source DC Sweep",
      experiment_type: "spice_dc_sweep",
      dc_sweep_current_source_id: "source_component_i1",
      dc_sweep_start: 0,
      dc_sweep_stop: 0.002,
      dc_sweep_step: 0.001,
      dc_sweep_unit: "A",
    },
  })
  expect(svg).toContain(">DC Sweep (A)</text>")
  expect(svg).toMatchSvgSnapshot(
    import.meta.path,
    "spicey-current-source-dc-sweep",
  )
})

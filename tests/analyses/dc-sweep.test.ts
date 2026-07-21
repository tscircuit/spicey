import { expect, test } from "bun:test"
import { simulateToCircuitJson } from "lib/index"

test("simulates a voltage-source DC sweep", () => {
  const spiceString = `
V1 in 0 DC 0
R1 in out 1k
R2 out 0 1k
.PRINT DC V(out) I(V1)
.dc V1 0 2 1
.end
`

  expect(
    simulateToCircuitJson({
      spiceString,
      simulationExperimentId: "simulation_experiment_0",
    }),
  ).toMatchObject([
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
})

test("simulates a current-source DC sweep", () => {
  const spiceString = `
I1 out 0 DC 0
R1 out 0 1k
.PRINT DC V(out) I(I1)
.dc I1 0 2m 1m
.end
`

  expect(
    simulateToCircuitJson({
      spiceString,
      simulationExperimentId: "simulation_experiment_0",
    }),
  ).toMatchObject([
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
})

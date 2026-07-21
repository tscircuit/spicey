import { expect, test } from "bun:test"
import { simulateToCircuitJson } from "lib/index"

test("simulates transient current-source voltage and current probes", () => {
  const spiceString = `
I1 out 0 DC 1m
R1 out 0 1k
.PRINT TRAN V(out) I(I1)
.tran 1u 2u
.end
`

  expect(
    simulateToCircuitJson({
      spiceString,
      simulationExperimentId: "simulation_experiment_0",
    }),
  ).toMatchObject([
    {
      type: "simulation_transient_voltage_graph",
      voltage_levels: [-1, -1, -1],
    },
    {
      type: "simulation_transient_current_graph",
      current_levels: [0.001, 0.001, 0.001],
    },
  ])
})

import { expect, test } from "bun:test"
import { simulateToCircuitJson } from "lib/index"
import { renderAnalysisGraphSvg } from "../fixtures/render-analysis-graph-svg"

test("simulates transient current-source voltage and current probes", () => {
  const spiceString = `
I1 out 0 DC 1m
R1 out 0 1k
.PRINT TRAN V(out) I(I1)
.tran 1u 2u
.end
`

  const circuitJson = simulateToCircuitJson({
    spiceString,
    simulationExperimentId: "simulation_experiment_0",
  })

  expect(circuitJson).toMatchObject([
    {
      type: "simulation_transient_voltage_graph",
      voltage_levels: [-1, -1, -1],
    },
    {
      type: "simulation_transient_current_graph",
      current_levels: [0.001, 0.001, 0.001],
    },
  ])

  const svg = renderAnalysisGraphSvg({
    simulationResultCircuitJson: circuitJson,
    simulationExperiment: {
      type: "simulation_experiment",
      simulation_experiment_id: "simulation_experiment_0",
      name: "Spicey Transient Voltage and Current",
      experiment_type: "spice_transient_analysis",
      time_per_step: 0.001,
      start_time_ms: 0,
      end_time_ms: 0.002,
    },
  })
  expect(svg).toMatchSvgSnapshot(
    import.meta.path,
    "spicey-transient-voltage-and-current",
  )
})

test("formats every transient node when no print vectors are requested", () => {
  const circuitJson = simulateToCircuitJson({
    spiceString: `
V1 out 0 DC 1
R1 out 0 1k
.tran 1u 2u
.end
`,
    simulationExperimentId: "simulation_experiment_0",
  })

  expect(circuitJson).toMatchObject([
    {
      type: "simulation_transient_voltage_graph",
      name: "out",
      voltage_levels: [1, 1, 1],
    },
  ])
})

import { expect, test } from "bun:test"
import type { SimulationExperiment } from "circuit-json"
import { simulate, simulateToCircuitJson } from "lib/index"
import { renderAnalysisGraphSvg } from "../fixtures/render-analysis-graph-svg"

test("simulates an octave AC sweep with complex voltage and current", () => {
  const spiceString = `
V1 in 0 DC 0 AC 2 30
R1 in out 1k
C1 out 0 1u
.PRINT AC V(in) I(V1)
.ac oct 1 10 80
.end
`
  const simulation = simulate(spiceString)

  expect(simulation.circuit.analyses.ac?.mode).toBe("oct")
  expect(simulation.ac?.freqs).toEqual([10, 20, 40, 80])

  const circuitJson = simulateToCircuitJson({
    spiceString,
    simulationExperimentId: "simulation_experiment_0",
  })

  expect(circuitJson).toHaveLength(2)
  expect(circuitJson[0]).toMatchObject({
    type: "simulation_ac_sweep_voltage_graph",
    frequencies_hz: [10, 20, 40, 80],
  })
  expect(circuitJson[1]).toMatchObject({
    type: "simulation_ac_sweep_current_graph",
    frequencies_hz: [10, 20, 40, 80],
  })

  const voltageGraph = circuitJson[0]
  if (voltageGraph?.type === "simulation_ac_sweep_voltage_graph") {
    expect(voltageGraph.complex_voltages[0]?.re).toBeCloseTo(Math.sqrt(3))
    expect(voltageGraph.complex_voltages[0]?.im).toBeCloseTo(1)
  }

  const simulationExperiment = {
    type: "simulation_experiment",
    simulation_experiment_id: "simulation_experiment_0",
    name: "Spicey AC Sweep",
    experiment_type: "spice_ac_analysis",
    ac_sweep_type: "octave",
    ac_samples_per_interval: 1,
    ac_start_frequency_hz: 10,
    ac_stop_frequency_hz: 80,
  } satisfies SimulationExperiment
  const magnitudeSvg = renderAnalysisGraphSvg({
    simulationResultCircuitJson: circuitJson,
    simulationExperiment,
  })
  const phaseSvg = renderAnalysisGraphSvg({
    simulationResultCircuitJson: circuitJson,
    simulationExperiment,
    acSweepView: "phase",
  })
  expect(magnitudeSvg).toMatchSvgSnapshot(
    import.meta.path,
    "spicey-ac-sweep-voltage-and-current-magnitude",
  )
  expect(phaseSvg).toMatchSvgSnapshot(
    import.meta.path,
    "spicey-ac-sweep-voltage-and-current-phase",
  )
})

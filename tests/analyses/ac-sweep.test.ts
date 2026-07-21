import { expect, test } from "bun:test"
import { simulate, simulateToCircuitJson } from "lib/index"

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
})

import { test, expect } from "bun:test"
import { simulate, formatTranResult, spiceyTranToVGraphs } from "lib/index"
import { convertCircuitJsonToSimulationGraphSvg } from "circuit-to-svg"
import type {
  CircuitJsonWithSimulation,
  SimulationExperimentElement,
} from "circuit-to-svg"

const twoProbesNetlist = `
* RC circuit with a pulse source and two probes

V1 1 0 PULSE(0 5 0 1n 1n 5u 10u)
R1 1 2 1k
C1 2 0 1u
.PRINT TRAN V(1) V(2)

.tran 0.1u 20u

.end
`

test("transient: two probes", () => {
  const { circuit, tran } = simulate(twoProbesNetlist)

  expect(circuit.probes.tran).toEqual(["1", "2"])

  expect(tran).not.toBeNull()
  if (!tran) return

  const { nodeVoltages } = tran
  expect(Object.keys(nodeVoltages).sort()).toEqual(["1", "2"])
  expect(nodeVoltages["1"]!.length).toBeGreaterThan(10)
  expect(nodeVoltages["2"]!.length).toBeGreaterThan(10)

  // Check that we're getting some values
  expect(nodeVoltages["1"]![0]).toBeCloseTo(0)
  expect(nodeVoltages["2"]![0]).toBeCloseTo(0)

  const result = formatTranResult(tran)
  expect(result).toContain("t(s), 1:V, 2:V")

  const simulation_experiment_id = "two_probes_rc_pulse"

  const simulationExperiment: SimulationExperimentElement = {
    type: "simulation_experiment",
    simulation_experiment_id,
    name: "RC Pulse with Two Probes",
    experiment_type: "transient_simulation",
  }

  const graphs = spiceyTranToVGraphs(tran, circuit, simulation_experiment_id)
  expect(graphs.length).toBe(2)

  const circuitJson: CircuitJsonWithSimulation[] = [
    simulationExperiment,
    ...graphs,
  ]

  const svg = convertCircuitJsonToSimulationGraphSvg({
    circuitJson,
    simulation_experiment_id,
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path, "two-probes-graph")
})

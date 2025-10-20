import { test, expect } from "bun:test"
import {
  simulate,
  eecEngineTranToVGraphs,
  spiceyTranToVGraphs,
} from "lib/index"
import { runNgspiceTransient } from "../fixtures/ngspice-transient"
import { convertCircuitJsonToSimulationGraphSvg } from "circuit-to-svg"
import type {
  CircuitJsonWithSimulation,
  SimulationExperimentElement,
} from "circuit-to-svg"

const rcPulseNetlist = `
* RC circuit with a pulse source

V1 1 0 PULSE(0 5 0 1n 1n 5u 10u)
R1 1 2 1k
C1 2 0 1u

.tran 0.1u 20u

.end
`

test("transient01: rc-pulse", async () => {
  const spiceyResult = simulate(rcPulseNetlist)

  const ngspiceResultForGraphing = await runNgspiceTransient(rcPulseNetlist)

  const simulation_experiment_id = "rc_pulse_experiment"

  const vGraphsSpicey = spiceyTranToVGraphs(
    spiceyResult.tran,
    spiceyResult.circuit,
    simulation_experiment_id,
  )
  const vGraphsNgspice = eecEngineTranToVGraphs(
    ngspiceResultForGraphing,
    spiceyResult.circuit,
    simulation_experiment_id,
  )

  const simulationExperiment: SimulationExperimentElement = {
    type: "simulation_experiment",
    simulation_experiment_id,
    name: "RC Circuit Pulse Response",
    experiment_type: "transient_simulation",
  }

  const circuitJson: CircuitJsonWithSimulation[] = [
    simulationExperiment,
    ...vGraphsSpicey,
    ...vGraphsNgspice,
  ]

  const svg = convertCircuitJsonToSimulationGraphSvg({
    circuitJson,
    simulation_experiment_id,
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path, "rc-pulse-comparison")
})

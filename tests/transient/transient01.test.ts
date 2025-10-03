import { test, expect } from "bun:test"
import {
  simulate,
  eecEngineTranToVGraphs,
  spiceyTranToVGraphs,
  type EecEngineTranResult,
} from "lib/index"
import { Simulation } from "eecircuit-engine"
import type { ResultType } from "eecircuit-engine"
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

  const sim = new Simulation()
  await sim.start()
  sim.setNetList(rcPulseNetlist)
  const ngspiceRawResult = (await sim.runSim()) as ResultType

  if (ngspiceRawResult.dataType !== "real") {
    throw new Error(
      "Expected real data type from ngspice for transient analysis",
    )
  }

  const timeData = ngspiceRawResult.data.find((d) => d.type === "time")
  if (!timeData) throw new Error("No time data in ngspice result")

  const ngspiceVoltages: Record<string, number[]> = {}
  for (const d of ngspiceRawResult.data) {
    if (d.type === "voltage") {
      const match = d.name.match(/^v\((\w+)\)$/i) // e.g. v(2) -> 2
      const nodeName = match ? match[1]! : d.name
      ngspiceVoltages[nodeName] = d.values as number[]
    }
  }

  const ngspiceResultForGraphing: EecEngineTranResult = {
    time_s: timeData.values as number[],
    voltages: ngspiceVoltages,
  }

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

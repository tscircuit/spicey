import { test, expect } from "bun:test"
import { simulate, spiceyTranToVGraphs } from "lib/index"
import { convertCircuitJsonToSimulationGraphSvg } from "circuit-to-svg"
import type {
  CircuitJsonWithSimulation,
  SimulationExperimentElement,
} from "circuit-to-svg"

const boostConverterNetlist = `
* Boost converter
.MODEL D D
.MODEL SWMOD SW
LL1 N1 N2 1
DD1 N2 N3 D
CC1 N3 0 10U
RR1 N3 0 1K
SM1 N2 0 N4 0 SWMOD
Vsimulation_voltage_source_0 N1 0 DC 5
Vsimulation_voltage_source_1 N4 0 PULSE(0 10 0 1n 1n 0.00068 0.001)
.PRINT TRAN V(N3)
.tran 0.00001 0.01
.END
`

test("transient: boost converter with probe", () => {
  const { circuit, tran } = simulate(boostConverterNetlist)

  expect(circuit.probes.tran).toEqual(["N3"])

  expect(tran).not.toBeNull()
  if (!tran) return

  const { nodeVoltages } = tran
  expect(Object.keys(nodeVoltages)).toEqual(["N3"])

  const simulation_experiment_id = "boost_converter_probe"

  const simulationExperiment: SimulationExperimentElement = {
    type: "simulation_experiment",
    simulation_experiment_id,
    name: "Boost Converter with Probe",
    experiment_type: "transient_simulation",
  }

  const graphs = spiceyTranToVGraphs(tran, circuit, simulation_experiment_id)
  expect(graphs.length).toBe(1)
  expect(graphs[0]?.name).toContain("N3")

  const circuitJson: CircuitJsonWithSimulation[] = [
    simulationExperiment,
    ...graphs,
  ]

  const svg = convertCircuitJsonToSimulationGraphSvg({
    circuitJson,
    simulation_experiment_id,
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path, "boost-converter-probe")
})

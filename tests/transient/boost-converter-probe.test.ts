import { test, expect } from "bun:test"
import {
  simulate,
  spiceyTranToVGraphs,
  eecEngineTranToVGraphs,
} from "lib/index"
import { runNgspiceTransient } from "../fixtures/ngspice-transient"
import { convertCircuitJsonToSimulationGraphSvg } from "circuit-to-svg"
import type {
  CircuitJsonWithSimulation,
  SimulationExperimentElement,
} from "circuit-to-svg"
import { compareVoltageLevels } from "../fixtures/compare-voltage-levels"

const boostConverterNetlist = `
* Circuit JSON to SPICE Netlist
.MODEL D D
.MODEL SWMOD SW
LL1 N1 N2 1
DD1 N2 N3 D
CC1 N3 0 10U
RR1 N3 0 1K
SM1 N2 0 N4 0 SWMOD
Vsimulation_voltage_source_0 N1 0 DC 5
Vsimulation_voltage_source_1 N4 0 PULSE(0 10 0 1n 1n 0.00068 0.001)
.PRINT TRAN V(n1) V(n3)
.tran 0.001 0.1 uic
.END
`

test("transient: boost converter with probe", async () => {
  const spiceyResult = simulate(boostConverterNetlist)

  expect(spiceyResult.tran).not.toBeNull()
  if (!spiceyResult.tran) return

  const ngspiceResultForGraphing = await runNgspiceTransient(
    boostConverterNetlist,
    { probes: spiceyResult.circuit.probes.tran },
  )

  const simulation_experiment_id = "boost_converter_probe"

  const simulationExperiment: SimulationExperimentElement = {
    type: "simulation_experiment",
    simulation_experiment_id,
    name: "Boost Converter with Probe",
    experiment_type: "transient_simulation",
  }

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

  const circuitJson: CircuitJsonWithSimulation[] = [
    simulationExperiment,
    ...vGraphsSpicey,
    ...vGraphsNgspice,
  ]

  const svg = convertCircuitJsonToSimulationGraphSvg({
    circuitJson,
    simulation_experiment_id,
  })

  expect(
    compareVoltageLevels(vGraphsSpicey, vGraphsNgspice),
  ).toMatchInlineSnapshot(`
    {
      "nodes": {
        "V(N1)": {
          "compared_samples": 101,
          "max_absolute_difference": 0,
          "mean_absolute_difference": 0,
          "percentage_difference": 0,
          "reference_max_magnitude": 5,
        },
        "V(N3)": {
          "compared_samples": 101,
          "max_absolute_difference": 5.868021,
          "mean_absolute_difference": 2.406636,
          "percentage_difference": 44.254385,
          "reference_max_magnitude": 5.438187,
        },
      },
      "overall_average_percentage_difference": 22.127192,
      "unmatched_ngspice_nodes": [],
      "unmatched_spicey_nodes": [],
    }
  `)
  expect(svg).toMatchSvgSnapshot(import.meta.path, "boost-converter-probe")
})

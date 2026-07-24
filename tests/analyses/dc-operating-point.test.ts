import { expect, test } from "bun:test"
import { simulate, simulateToCircuitJson } from "lib/index"
import { renderAnalysisGraphSvg } from "../fixtures/render-analysis-graph-svg"

const operatingPointNetlist = `
V1 in 0 DC 5
R1 in out 1k
R2 out 0 1k
* tscircuit_probe {"simulation_voltage_probe_id":"simulation_voltage_probe_0","name":"VOUT","spice_vector":"V(out)","source_node_name":"out"}
* tscircuit_current_probe {"simulation_current_probe_id":"simulation_current_probe_0","name":"IV1","spice_vector":"I(V1)"}
.PRINT OP V(out) I(V1)
.op
.end
`

test("simulates and formats a DC operating point", () => {
  const simulation = simulate(operatingPointNetlist)

  expect(simulation.op?.nodeVoltages.out).toBeCloseTo(2.5)
  expect(simulation.op?.elementCurrents.V1).toBeCloseTo(-0.0025)

  const circuitJson = simulateToCircuitJson({
    spiceString: operatingPointNetlist,
    simulationExperimentId: "simulation_experiment_0",
  })

  expect(circuitJson).toEqual([
    {
      type: "simulation_dc_operating_point_voltage",
      simulation_dc_operating_point_voltage_id:
        "simulation_dc_operating_point_voltage_simulation_voltage_probe_0",
      simulation_experiment_id: "simulation_experiment_0",
      simulation_voltage_probe_id: "simulation_voltage_probe_0",
      voltage: 2.5,
      name: "VOUT",
    },
    {
      type: "simulation_dc_operating_point_current",
      simulation_dc_operating_point_current_id:
        "simulation_dc_operating_point_current_simulation_current_probe_0",
      simulation_experiment_id: "simulation_experiment_0",
      simulation_current_probe_id: "simulation_current_probe_0",
      current: -0.0025,
      name: "IV1",
    },
  ])

  const svg = renderAnalysisGraphSvg({
    simulationResultCircuitJson: circuitJson,
    simulationExperiment: {
      type: "simulation_experiment",
      simulation_experiment_id: "simulation_experiment_0",
      name: "Spicey DC Operating Point",
      experiment_type: "spice_dc_operating_point",
    },
  })
  expect(svg).toMatchSvgSnapshot(
    import.meta.path,
    "spicey-dc-operating-point-voltage-and-current",
  )
})

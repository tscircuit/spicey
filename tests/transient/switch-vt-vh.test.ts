import { test, expect } from "bun:test"
import { simulate, spiceyTranToVGraphs } from "lib/index"
import { convertCircuitJsonToSimulationGraphSvg } from "circuit-to-svg"
import type {
  CircuitJsonWithSimulation,
  SimulationExperimentElement,
} from "circuit-to-svg"

const netlist = `
* Switch test with Vt and Vh model parameters
.MODEL SW_SW1 SW(Ron=0.1 Roff=1e9 Vt=2.5 Vh=0.1)
VCTRL_SW1 NCTRL_SW1 0 PULSE(0 5 0 1n 1n 0.0005 0.001)
SSW1 N1 N2 NCTRL_SW1 0 SW_SW1
RR1 N2 0 1K
Vsimulation_voltage_source_0 N1 0 DC 5
.PRINT TRAN V(n2) V(nctrl_sw1)
.tran 0.00001 0.004
.END
`

test("transient: switch with Vt and Vh", () => {
  const { circuit, tran } = simulate(netlist)

  expect(circuit.S.length).toBe(1)
  const sw = circuit.S[0]
  expect(sw).toBeDefined()
  if (!sw) return

  const model = sw.model
  expect(model).toBeDefined()
  if (!model) return

  expect(model.Von).toBeCloseTo(2.55)
  expect(model.Voff).toBeCloseTo(2.45)

  expect(circuit.probes.tran).toEqual(["n2", "nctrl_sw1"])

  expect(tran).not.toBeNull()
  if (!tran) return

  const { times, nodeVoltages } = tran
  const vOut = nodeVoltages.N2
  expect(vOut).toBeDefined()
  if (!vOut) return

  const sample = (targetTime: number) => {
    let bestIdx = -1
    let bestDiff = Infinity
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!
      const diff = Math.abs(t - targetTime)
      if (diff < bestDiff) {
        bestDiff = diff
        bestIdx = i
      }
    }
    return vOut[bestIdx]!
  }

  // At 0.2ms, control pulse is high (5V), switch is ON.
  expect(sample(0.0002)).toBeGreaterThan(4.9)

  // At 0.7ms, control pulse is low (0V), switch is OFF.
  expect(sample(0.0007)).toBeLessThan(0.1)

  // At 1.2ms, control pulse is high, switch is ON.
  expect(sample(0.0012)).toBeGreaterThan(4.9)

  // At 1.7ms, control pulse is low, switch is OFF.
  expect(sample(0.0017)).toBeLessThan(0.1)
})

test("transient: switch with Vt and Vh snapshot", () => {
  const { circuit, tran } = simulate(netlist)

  expect(tran).not.toBeNull()
  if (!tran) return

  const simulation_experiment_id = "switch_vt_vh_test"

  const simulationExperiment: SimulationExperimentElement = {
    type: "simulation_experiment",
    simulation_experiment_id,
    name: "Switch with Vt and Vh",
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

  expect(svg).toMatchSvgSnapshot(import.meta.path, "switch-vt-vh-graph")
})

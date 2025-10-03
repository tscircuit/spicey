import { test, expect } from "bun:test"
import {
  simulate,
  eecEngineTranToVGraphs,
  spiceyTranToVGraphs,
  type EecEngineTranResult,
} from "lib/index"
import { plotVGraph } from "../utils/plotVGraph"
import { Simulation } from "eecircuit-engine"
import type { ResultType } from "eecircuit-engine"

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

  const vGraphsSpicey = spiceyTranToVGraphs(
    spiceyResult.tran,
    spiceyResult.circuit,
    "rc_pulse",
  )
  const vGraphsNgspice = eecEngineTranToVGraphs(
    ngspiceResultForGraphing,
    spiceyResult.circuit,
    "rc_pulse",
  )

  const combinedGraphs = [...vGraphsSpicey, ...vGraphsNgspice]

  const svg = plotVGraph(combinedGraphs, {
    title: "RC Circuit Pulse Response",
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path, "rc-pulse-comparison")
})

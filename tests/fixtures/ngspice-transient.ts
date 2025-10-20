import { Simulation } from "eecircuit-engine"
import type { ResultType } from "eecircuit-engine"
import type { EecEngineTranResult } from "lib/index"

/**
 * Run the given netlist with ngspice (via eecircuit-engine) and return
 * an EecEngineTranResult suitable for graphing alongside spicey results.
 *
 * - If opts.probes is provided, only those node voltages (case-insensitive) are included.
 * - Otherwise, all node voltages returned by ngspice are included.
 */
export async function runNgspiceTransient(
  netlist: string,
  opts?: { probes?: string[] },
): Promise<EecEngineTranResult> {
  const sim = new Simulation()
  await sim.start()
  sim.setNetList(netlist)
  const ngspiceRawResult = (await sim.runSim()) as ResultType

  if (ngspiceRawResult.dataType !== "real") {
    throw new Error(
      "Expected real data type from ngspice for transient analysis",
    )
  }

  const timeData = ngspiceRawResult.data.find((d) => d.type === "time")
  if (!timeData) throw new Error("No time data in ngspice result")

  const probesUpper = (opts?.probes ?? []).map((p) => p.toUpperCase())
  const voltages: Record<string, number[]> = {}

  for (const d of ngspiceRawResult.data) {
    if (d.type === "voltage") {
      const match = d.name.match(/^v\(([^)]+)\)$/i) // e.g. v(2) -> 2
      const nodeName = match ? match[1]! : d.name
      if (
        probesUpper.length === 0 ||
        probesUpper.includes(nodeName.toUpperCase())
      ) {
        voltages[nodeName] = d.values as number[]
      }
    }
  }

  // Best-effort shutdown; some environments may not expose stop()
  // @ts-expect-error optional API
  await sim.stop?.()

  return {
    time_s: timeData.values as number[],
    voltages,
  }
}

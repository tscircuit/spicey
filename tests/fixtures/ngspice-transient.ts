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
  if (
    !(globalThis as { __spiceyDataFetchPatched?: boolean })
      .__spiceyDataFetchPatched
  ) {
    const originalFetch = globalThis.fetch
    if (originalFetch) {
      const DATA_WASM_PREFIX = "data:application/wasm;base64,"

      type FetchArgs = Parameters<typeof originalFetch>

      const patchedFetch = async (
        input: FetchArgs[0],
        init?: FetchArgs[1],
      ): Promise<Response> => {
        const resource =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input)

        if (resource.startsWith(DATA_WASM_PREFIX)) {
          const base64 = resource.slice(DATA_WASM_PREFIX.length)
          const buffer = Buffer.from(base64, "base64")
          return new Response(buffer, {
            status: 200,
            headers: { "Content-Type": "application/wasm" },
          })
        }

        return originalFetch.call(globalThis, input, init as FetchArgs[1])
      }

      const fetchWithPreconnect = patchedFetch as typeof globalThis.fetch
      if (typeof originalFetch.preconnect === "function") {
        fetchWithPreconnect.preconnect =
          originalFetch.preconnect.bind(originalFetch)
      }

      globalThis.fetch = fetchWithPreconnect
    }

    if (typeof WebAssembly.instantiateStreaming !== "function") {
      type InstantiateImportObject = Parameters<
        (typeof WebAssembly)["instantiate"]
      >[1]

      WebAssembly.instantiateStreaming = (async (
        source: Response | Promise<Response>,
        importObject?: InstantiateImportObject,
      ) => {
        const response = await source
        const buffer = await response.arrayBuffer()
        return WebAssembly.instantiate(buffer, importObject)
      }) as typeof WebAssembly.instantiateStreaming
    }

    ;(
      globalThis as { __spiceyDataFetchPatched?: boolean }
    ).__spiceyDataFetchPatched = true
  }

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

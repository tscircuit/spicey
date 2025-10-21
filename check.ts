import { simulate } from "./lib/index"
import { runNgspiceTransient } from "./tests/fixtures/ngspice-transient"

if (typeof WebAssembly.instantiateStreaming !== "function") {
  const instantiateStreaming = async (
    source: Response | Promise<Response>,
    importObject?: unknown,
  ) => {
    const response = source instanceof Response ? source : await source
    const bytes = await response.arrayBuffer()
    return WebAssembly.instantiate(bytes, importObject as any)
  }
  // @ts-expect-error augment global helper
  WebAssembly.instantiateStreaming = instantiateStreaming
}

const netlist = `
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

const main = async () => {
  const spiceyResult = simulate(netlist)
  if (!spiceyResult.tran) throw new Error("no tran result")
  const ng = await runNgspiceTransient(netlist, {
    probes: spiceyResult.circuit.probes.tran,
  })

  const node = "N3"
  const times = spiceyResult.tran.times
  const values = spiceyResult.tran.nodeVoltages[node]!
  const ngValuesEntry = Object.entries(ng.voltages).find(
    ([name]) => name.toUpperCase() === node,
  )
  if (!ngValuesEntry) throw new Error(`ngspice missing node ${node}`)
  const ngValues = ngValuesEntry[1]!
  const ngTimes = ng.time_s

  const sampleNg = (time: number) => {
    let idx = 0
    while (idx < ngTimes.length && ngTimes[idx]! < time) idx++
    if (idx === 0) return ngValues[0]!
    if (idx >= ngTimes.length) return ngValues[ngTimes.length - 1]!
    const t0 = ngTimes[idx - 1]!
    const t1 = ngTimes[idx]!
    const v0 = ngValues[idx - 1]!
    const v1 = ngValues[idx]!
    const frac = (time - t0) / (t1 - t0 || 1)
    return v0 + frac * (v1 - v0)
  }

  let maxDiff = 0
  let maxRel = 0
  let timeAtMax = 0
  let spiceyValAtMax = 0
  let ngValAtMax = 0

  for (let i = 0; i < times.length; i++) {
    const t = times[i]!
    const sVal = values[i]!
    const ngVal = sampleNg(t)
    const diff = Math.abs(sVal - ngVal)
    const rel = diff / Math.max(Math.abs(ngVal), 1e-9)
    if (diff > maxDiff) {
      maxDiff = diff
      maxRel = rel
      timeAtMax = t
      spiceyValAtMax = sVal
      ngValAtMax = ngVal
    }
  }

  console.log(
    JSON.stringify(
      {
        node,
        count: times.length,
        maxDiff,
        maxRel,
        timeAtMax,
        spiceyValAtMax,
        ngValAtMax,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

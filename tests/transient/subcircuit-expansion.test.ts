import { expect, test } from "bun:test"
import { expandSubcircuits, parseNetlist, simulate } from "lib/index"
import { runNgspiceTransient } from "../fixtures/ngspice-transient"

function interpolateAtTime(
  times: number[],
  values: number[],
  targetTime: number,
): number {
  if (times.length === 0 || values.length === 0) return 0
  if (targetTime <= times[0]!) return values[0]!
  const lastIdx = Math.min(times.length, values.length) - 1
  if (targetTime >= times[lastIdx]!) return values[lastIdx]!

  let lo = 0
  let hi = lastIdx
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if ((times[mid] ?? 0) <= targetTime) lo = mid
    else hi = mid
  }
  const t0 = times[lo]!
  const t1 = times[hi]!
  const v0 = values[lo]!
  const v1 = values[hi]!
  if (t1 <= t0) return v0
  return v0 + ((targetTime - t0) / (t1 - t0)) * (v1 - v0)
}

test("expands parameterized and nested .subckt instances in AC analysis", () => {
  const netlist = `
Parameterized nested RC subcircuit AC test
.param RGLOBAL=1k

.subckt RC_STAGE vin vout gnd PARAMS: RVAL={RGLOBAL} CVAL=1u
  .subckt SERIES_R a b RSER=500
    R1 a b {RSER}
  .ends SERIES_R
  Xser vin mid SERIES_R RSER={RVAL / 2}
  R2 mid vout {RVAL / 2}
  C1 vout gnd {CVAL}
.ends RC_STAGE

V1 in 0 DC 0 AC 1
Xstage1 in n1 0 RC_STAGE
Xstage2 n1 out 0 RC_STAGE RVAL=2k CVAL=0.5u
.ac lin 3 100 300
.end
`

  const { circuit, ac } = simulate(netlist)
  expect(circuit.R).toHaveLength(4)
  expect(circuit.C).toHaveLength(2)
  expect(ac).not.toBeNull()
  if (!ac) return

  expect(ac.freqs).toEqual([100, 200, 300])
  const outSeries = ac.nodeVoltages["out"]
  expect(outSeries).toBeDefined()
  if (!outSeries) return
  expect(outSeries).toHaveLength(3)

  // Compare against an equivalent flat circuit with identical component values:
  // stage1: 500 + 500 = 1k, C1 = 1uF; stage2: 1k + 1k = 2k, C2 = 0.5uF
  const flatNetlist = `
Flat reference circuit
V1 in 0 DC 0 AC 1
R1a in m1 500
R1b m1 n1 500
C1 n1 0 1u
R2a n1 m2 1k
R2b m2 out 1k
C2 out 0 0.5u
.ac lin 3 100 300
.end
`
  const flatResult = simulate(flatNetlist)
  const flatOut = flatResult.ac?.nodeVoltages["out"]
  expect(flatOut).toBeDefined()
  if (!flatOut) return

  for (let i = 0; i < outSeries.length; i++) {
    expect(outSeries[i]!.re).toBeCloseTo(flatOut[i]!.re, 10)
    expect(outSeries[i]!.im).toBeCloseTo(flatOut[i]!.im, 10)
  }
})

test("scopes subcircuit-local .model definitions, internal nodes, and + continuations against ngspice", async () => {
  const netlist = `
* Dual switched RC subcircuit transient test
.subckt SWITCHED_TAP vin vout ctrl gnd PARAMS: RON_VAL=1 RLOAD=1k CLOAD=1u
.model LOCAL_SW SW(
+ Ron={RON_VAL}
+ Roff=1e9
+ Vt=2.5
+ Vh=0.1
+ )
S1 vin tap ctrl gnd LOCAL_SW
R1 tap vout {RLOAD}
C1 vout gnd {CLOAD}
.ends SWITCHED_TAP

Vsup in 0 DC 5
Vctrl ctrl 0 PULSE(0 5 1m 10u 10u 4m 10m)
Xfast in out_fast ctrl 0 SWITCHED_TAP
+ RON_VAL=1
+ RLOAD=1k
+ CLOAD=0.5u
Xslow in out_slow ctrl 0 SWITCHED_TAP RON_VAL=2k RLOAD=1k CLOAD=0.5u
Rbleed1 out_fast 0 10k
Rbleed2 out_slow 0 10k
.tran 20u 4m
.print tran v(out_fast) v(out_slow)
.end
`

  const spiceyRes = simulate(netlist)
  expect(spiceyRes.circuit.S).toHaveLength(2)
  expect(spiceyRes.circuit.models.vswitch.size).toBe(2)
  expect(spiceyRes.tran).not.toBeNull()
  if (!spiceyRes.tran) return

  const ngspiceRes = await runNgspiceTransient(netlist, {
    probes: ["out_fast", "out_slow"],
  })

  for (const nodeName of ["out_fast", "out_slow"] as const) {
    const spiceySeries = spiceyRes.tran.nodeVoltages[nodeName]!
    const ngKey = Object.keys(ngspiceRes.voltages).find(
      (k) => k.toLowerCase() === nodeName,
    )
    expect(ngKey).toBeDefined()
    const ngSeries = ngspiceRes.voltages[ngKey!]!

    let absDiffSum = 0
    for (let i = 0; i < spiceyRes.tran.times.length; i++) {
      const t = spiceyRes.tran.times[i]!
      const ngVal = interpolateAtTime(ngspiceRes.time_s, ngSeries, t)
      absDiffSum += Math.abs(spiceySeries[i]! - ngVal)
    }
    const meanAbsError = absDiffSum / spiceyRes.tran.times.length
    expect(meanAbsError).toBeLessThan(0.06)
  }

  // Verify the two scoped .model definitions stayed distinct (out_fast charges faster than out_slow)
  const fastPeak = Math.max(...spiceyRes.tran.nodeVoltages["out_fast"]!)
  const slowPeak = Math.max(...spiceyRes.tran.nodeVoltages["out_slow"]!)
  expect(fastPeak).toBeGreaterThan(slowPeak + 0.5)
})

test("rejects unknown subcircuits, port mismatches, and recursive subcircuit cycles", () => {
  expect(() =>
    parseNetlist(`
* Unknown subcircuit
V1 in 0 DC 5
X1 in out MISSING_SUB
.tran 1m 10m
.end
`),
  ).toThrow(/Unknown \.subckt/i)

  expect(() =>
    parseNetlist(`
* Port count mismatch
.subckt TWO_PORT a b
R1 a b 1k
.ends TWO_PORT
V1 in 0 DC 5
X1 in out extra TWO_PORT
.tran 1m 10m
.end
`),
  ).toThrow(/expects 2 port\(s\)/i)

  expect(() =>
    expandSubcircuits(`
* Cyclic subcircuit
.subckt LOOP_A a b
X1 a b LOOP_B
.ends LOOP_A
.subckt LOOP_B a b
X1 a b LOOP_A
.ends LOOP_B
Xtop 1 0 LOOP_A
.end
`),
  ).toThrow(/Recursive \.subckt/i)
})

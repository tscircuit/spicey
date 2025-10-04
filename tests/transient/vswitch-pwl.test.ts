import { test, expect } from "bun:test"
import { simulate } from "lib/index"

const switchNetlist = `
* SPST switch between node OUT and ground, turns ON at 1ms, OFF at 3ms, ON at 7ms
V1    IN     0      DC 5
R1    IN     OUT    1k
C1    OUT    0      1u

* control waveform: 0V=OFF, 5V=ON at specific times
VCTRL CTRL   0      PWL(0 0   1m 5   3m 0   7m 5   9m 0)

* voltage-controlled switch: S <p> <n> <cp> <cn> <model>
S1    OUT    0      CTRL 0    SW
.model SW VSWITCH(Ron=1 Roff=1e9 Von=2 Voff=1)

.tran 0 10m
`

test("transient: voltage-controlled switch with PWL control", () => {
  const { circuit, tran } = simulate(switchNetlist)

  expect(circuit.S.length).toBe(1)
  const sw = circuit.S[0]
  expect(sw?.model?.Ron).toBeCloseTo(1, 6)
  expect(sw?.model?.Roff).toBeCloseTo(1e9, 0)
  expect(sw?.model?.Von).toBeCloseTo(2, 6)
  expect(sw?.model?.Voff).toBeCloseTo(1, 6)

  expect(tran).not.toBeNull()
  if (!tran) return

  const { times, nodeVoltages } = tran
  const vOut = nodeVoltages.OUT
  const vCtrl = nodeVoltages.CTRL
  expect(vOut).toBeDefined()
  expect(vCtrl).toBeDefined()
  if (!vOut || !vCtrl) return

  const sample = (target: number) => {
    let bestIdx = 0
    let bestDiff = Number.POSITIVE_INFINITY
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(times[i]! - target)
      if (diff < bestDiff) {
        bestDiff = diff
        bestIdx = i
      }
    }
    return { out: vOut[bestIdx]!, ctrl: vCtrl[bestIdx]! }
  }

  const earlyOn = sample(0.0005)
  expect(earlyOn.ctrl).toBeGreaterThan(2)
  expect(Math.abs(earlyOn.out)).toBeLessThan(0.02)

  const afterOff = sample(0.0035)
  expect(afterOff.ctrl).toBeLessThan(1)
  expect(afterOff.out).toBeGreaterThan(2)

  const stillOffBeforeReon = sample(0.0045)
  expect(stillOffBeforeReon.ctrl).toBeLessThan(2)
  expect(stillOffBeforeReon.out).toBeGreaterThan(4)

  const onAgain = sample(0.0085)
  expect(onAgain.ctrl).toBeGreaterThan(1)
  expect(Math.abs(onAgain.out)).toBeLessThan(0.02)

  const finalRecharge = sample(0.0095)
  expect(finalRecharge.ctrl).toBeCloseTo(0, 9)
  expect(finalRecharge.out).toBeGreaterThan(2)
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { parseNumberWithUnits } from "../../lib/parsing/parseNumberWithUnits"
import { parseNetlist } from "../../lib/parsing/parseNetlist"

function assertValue(actual: number, expected: number) {
  assert.ok(Number.isFinite(actual), `expected a finite value, got ${actual}`)
  if (expected === 0) {
    assert.equal(actual, 0)
  } else {
    assert.ok(
      Math.abs(actual - expected) <= Math.abs(expected) * 1e-14,
      `expected ${expected}, got ${actual}`,
    )
  }
}

// SPICE f/F is the femto scale factor, not a bare farad unit.
// Other supported scale factors and physical-unit suffixes must keep working.
const values: [string, number][] = [
  ["1f", 1e-15],
  ["1F", 1e-15],
  ["47f", 4.7e-14],
  ["-2.5F", -2.5e-15],
  [".5f", 5e-16],
  ["1e3f", 1e-12],
  ["0F", 0],
  ["1fF", 1e-15],
  ["47FF", 4.7e-14],
  ["2fA", 2e-15],
  ["2fOhm", 2e-15],
  ["1t", 1e12],
  ["1g", 1e9],
  ["1meg", 1e6],
  ["1k", 1e3],
  ["1m", 1e-3],
  ["1u", 1e-6],
  ["1n", 1e-9],
  ["1p", 1e-12],
  ["1MEG", 1e6],
  ["1M", 1e-3],
  ["10pF", 1e-11],
  ["100uF", 1e-4],
  ["3mH", 3e-3],
  ["2kOhm", 2e3],
  ["5V", 5],
  ["2A", 2],
  ["3s", 3],
  ["4H", 4],
  ["1e-15", 1e-15],
  ["42", 42],
  ["0", 0],
]

for (const [input, expected] of values) {
  test(`parseNumberWithUnits preserves the scale of ${input}`, () => {
    assertValue(parseNumberWithUnits(input), expected)
  })
}

test("preserves whitespace, numeric inputs, and existing fallback behavior", () => {
  assertValue(parseNumberWithUnits(" 1F "), 1e-15)
  assert.equal(parseNumberWithUnits(12), 12)
  for (const input of [undefined, null, "", " ", "not-a-number"]) {
    assert.ok(Number.isNaN(parseNumberWithUnits(input)))
  }
  assert.equal(parseNumberWithUnits("12unknown"), 12)
})

test("parseNetlist applies femto to R, C, and L values without losing nodes", () => {
  const circuit = parseNetlist(
    "R1 in out 1f\nC1 out 0 47F\nL1 in 0 2.5f\n.end",
  )
  assert.equal(circuit.R.length, 1)
  assert.equal(circuit.C.length, 1)
  assert.equal(circuit.L.length, 1)
  assertValue(circuit.R[0]!.R, 1e-15)
  assertValue(circuit.C[0]!.C, 4.7e-14)
  assertValue(circuit.L[0]!.L, 2.5e-15)
  assert.equal(circuit.R[0]!.n2, circuit.C[0]!.n1)
  assert.equal(circuit.C[0]!.n2, 0)
  assert.equal(circuit.L[0]!.n2, 0)
  assert.deepEqual(circuit.skipped, [])
})

test("parseNetlist preserves scaled physical units and the README circuit values", () => {
  const circuit = parseNetlist(
    "Demo of a simple AC circuit\nv1 1 0 dc 0 ac 1\nr1 1 2 30\nc1 2 0 100u\n.ac dec 100 1 100\n.end",
  )
  assertValue(circuit.C[0]!.C, 1e-4)
  assert.equal(circuit.R[0]!.R, 30)
  assert.equal(circuit.V[0]!.acMag, 1)
  assert.deepEqual(circuit.analyses.ac, { mode: "dec", N: 100, f1: 1, f2: 100 })
  const units = parseNetlist("C1 1 0 10pF\nL1 1 0 3mH\nR1 1 0 2kOhm\n.end")
  assertValue(units.C[0]!.C, 1e-11)
  assertValue(units.L[0]!.L, 3e-3)
  assertValue(units.R[0]!.R, 2e3)
})

test("parseNetlist applies femto to diode model parameters", () => {
  const circuit = parseNetlist(
    ".model tiny D(Is=10F N=1)\nD1 in 0 tiny\n.end",
  )
  assertValue(circuit.D[0]!.model!.Is, 1e-14)
  assert.equal(circuit.D[0]!.model!.N, 1)
  assert.equal(circuit.D[0]!.model, circuit.models.diode.get("tiny"))
})

test("parseNetlist applies femto to voltage and analysis values", () => {
  const circuit = parseNetlist(
    "V1 in 0 DC 2f AC 3F\n.tran 1f 10F\n.end",
  )
  assertValue(circuit.V[0]!.dc, 2e-15)
  assertValue(circuit.V[0]!.acMag, 3e-15)
  assertValue(circuit.analyses.tran!.dt, 1e-15)
  assertValue(circuit.analyses.tran!.tstop, 1e-14)
})

test("parseNetlist preserves femto PULSE and PWL amplitudes", () => {
  const circuit = parseNetlist(
    "V1 in 0 PULSE(1f 2F 0 1u 1u 2u 5u)\nV2 out 0 PWL(0 3f 1u 4F)\n.end",
  )
  assertValue(circuit.V[0]!.waveform!(0), 1e-15)
  assertValue(circuit.V[0]!.waveform!(2e-6), 2e-15)
  assertValue(circuit.V[1]!.waveform!(0), 3e-15)
  assertValue(circuit.V[1]!.waveform!(1e-6), 4e-15)
})

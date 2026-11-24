import { test, expect } from "bun:test"
import { parseNetlist } from "lib/parsing/parseNetlist"
import { parseNumberWithUnits } from "lib/parsing/parseNumberWithUnits"

test("parseNumberWithUnits: bare f suffix is femto (1e-15)", () => {
  expect(parseNumberWithUnits("1f")).toBeCloseTo(1e-15, 20)
  expect(parseNumberWithUnits("4.7f")).toBeCloseTo(4.7e-15, 20)
  expect(parseNumberWithUnits("1F")).toBeCloseTo(1e-15, 20)
})

test("parseNumberWithUnits: other scale suffixes keep working", () => {
  expect(parseNumberWithUnits("1fs")).toBeCloseTo(1e-15, 20)
  expect(parseNumberWithUnits("10uf")).toBeCloseTo(10e-6, 12)
  expect(parseNumberWithUnits("2p")).toBeCloseTo(2e-12, 20)
  expect(parseNumberWithUnits("5n")).toBeCloseTo(5e-9, 20)
  expect(parseNumberWithUnits("1meg")).toBeCloseTo(1e6, 6)
  expect(parseNumberWithUnits("3k")).toBeCloseTo(3e3, 6)
  expect(parseNumberWithUnits("10mv")).toBeCloseTo(10e-3, 12)
})

test("netlist: capacitor value of 1f parses as 1e-15", () => {
  const netlist = `
V1 in 0 1
C1 in 0 1f
.tran 1n 10n
.end
`
  const circuit = parseNetlist(netlist)
  const cap = circuit.C.find((c) => c.name === "C1")
  expect(cap).toBeDefined()
  expect(cap!.C).toBeCloseTo(1e-15, 20)
})

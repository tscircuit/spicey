import { test, expect } from "bun:test"
import { simulate, formatTranResult } from "lib/index"

const netlist = `
* Diode and Switch test
.MODEL D D
.MODEL SWMOD SW
LL1 N1 N2 1
DD1 N2 N3 D
CC1 N3 0 10U
RR1 N3 0 1K
SM1 N2 0 N4 0 SWMOD
Vsimulation_voltage_source_0 N1 0 DC 5
Vsimulation_voltage_source_1 N4 0 PULSE(0 10 0 1n 1n 0.00068 0.001)
.tran 0.00001 0.01
.END
`

test("transient: diode and switch model", () => {
  const { circuit, tran } = simulate(netlist)

  expect(circuit.D.length).toBe(1)
  expect(circuit.S.length).toBe(1)
  expect(circuit.models.diode.has("d")).toBe(true)
  expect(circuit.models.vswitch.has("swmod")).toBe(true)

  const dModel = circuit.models.diode.get("d")
  expect(dModel).toBeDefined()
  if (!dModel) return
  expect(dModel.Is).toBe(1e-14) // default

  const swModel = circuit.models.vswitch.get("swmod")
  expect(swModel).toBeDefined()
  if (!swModel) return
  expect(swModel.Ron).toBe(1) // default

  expect(tran).not.toBeNull()
  // For now, just checking it runs without error.
  const result = formatTranResult(tran)
  expect(result).toContain("t(s),")
  expect(result.split("\n").length).toBeGreaterThan(10)
})

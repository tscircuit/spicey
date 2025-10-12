import { test, expect } from "bun:test"
import { simulate, formatTranResult } from "lib/index"

const netlist = `
* Case-insensitivity test for nodes and probes

V1 nOdE1 0 PULSE(0 5 0 1n 1n 5u 10u)
R1 NODE1 nOde2 1k
C1 node2 0 1u
.PRINT TRAN V(node1) V(NODE2)

.tran 0.1u 20u

.end
`

test("transient: case-insensitive nodes and probes", () => {
  const { circuit, tran } = simulate(netlist)

  // Nodes are case-insensitive, so nOdE1, NODE1, node1 should be the same.
  // The first occurrence 'nOdE1' should be the canonical name.
  // Similarly for nOde2, node2, NODE2 -> 'nOde2'
  expect(circuit.nodes.count()).toBe(3) // 0, nOdE1, nOde2
  expect(circuit.nodes.rev).toEqual(["0", "nOdE1", "nOde2"])

  // Probes are deduped case-insensitively, but casing is preserved from .PRINT
  expect(circuit.probes.tran.sort()).toEqual(["NODE2", "node1"].sort())

  expect(tran).not.toBeNull()
  if (!tran) return

  const { nodeVoltages } = tran
  // The result should have the canonical node names
  expect(Object.keys(nodeVoltages).sort()).toEqual(["nOde2", "nOdE1"].sort())
  expect(nodeVoltages["nOdE1"]!.length).toBeGreaterThan(10)
  expect(nodeVoltages["nOde2"]!.length).toBeGreaterThan(10)

  const result = formatTranResult(tran)
  // The formatted result should use canonical names
  expect(result).toContain("nOdE1:V")
  expect(result).toContain("nOde2:V")
})

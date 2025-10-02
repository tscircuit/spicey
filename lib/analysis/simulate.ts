import { parseNetlist } from "../parsing/parseNetlist"
import { simulateAC } from "./simulateAC"
import { simulateTRAN } from "./simulateTRAN"

function simulate(netlistText: string) {
  const circuit = parseNetlist(netlistText)
  const ac = simulateAC(circuit)
  const tran = simulateTRAN(circuit)
  return { circuit, ac, tran }
}

export { simulate }

import { parseNetlist } from "../parsing/parseNetlist"
import { simulateAC } from "./simulateAC"
import { simulateTRAN } from "./simulateTRAN"
import { simulateDCOperatingPoint } from "./simulateDCOperatingPoint"
import { simulateDCSweep } from "./simulateDCSweep"

function simulate(netlistText: string) {
  const circuit = parseNetlist(netlistText)
  const ac = simulateAC(circuit)
  const tran = simulateTRAN(circuit)
  const op = simulateDCOperatingPoint(circuit)
  const dc = simulateDCSweep(circuit)
  return { circuit, ac, tran, op, dc }
}

export { simulate }

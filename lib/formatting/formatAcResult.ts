import { Complex } from "../math/Complex"

function formatAcResult(
  ac: {
    freqs: number[]
    nodeVoltages: Record<string, Complex[]>
  } | null,
) {
  if (!ac) return "No AC analysis.\n"
  const nodes = Object.keys(ac.nodeVoltages)
  const lines: string[] = []
  lines.push(`f(Hz), ` + nodes.map((n) => `${n}:|V|,∠V(deg)`).join(", "))
  for (let k = 0; k < ac.freqs.length; k++) {
    const freq = ac.freqs[k]
    if (freq == null) continue
    const parts = [freq.toPrecision(6)]
    for (const n of nodes) {
      const z = ac.nodeVoltages[n]?.[k]
      if (!z) continue
      parts.push(`${z.abs().toPrecision(6)},${z.phaseDeg().toPrecision(6)}`)
    }
    lines.push(parts.join(", "))
  }
  return lines.join("\n")
}

export { formatAcResult }

function formatTranResult(
  tran: {
    times: number[]
    nodeVoltages: Record<string, number[]>
  } | null,
) {
  if (!tran) return "No TRAN analysis.\n"
  const nodes = Object.keys(tran.nodeVoltages)
  const header = ["t(s)", ...nodes.map((n) => `${n}:V`)]
  const lines = [header.join(", ")]
  for (let k = 0; k < tran.times.length; k++) {
    const time = tran.times[k]
    if (time == null) continue
    const row = [time.toPrecision(6)]
    for (const n of nodes) {
      const value = tran.nodeVoltages[n]?.[k]
      if (value == null) continue
      row.push((+value).toPrecision(6))
    }
    lines.push(row.join(", "))
  }
  return lines.join("\n")
}

export { formatTranResult }

import type { SimulationTransientVoltageGraph } from "circuit-json"

export function plotVGraph(
  graphs: SimulationTransientVoltageGraph[],
  options: {
    width?: number
    height?: number
    title?: string
  } = {},
): string {
  const width = options.width ?? 800
  const height = options.height ?? 400
  const margin = { top: 40, right: 120, bottom: 40, left: 60 }

  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  let minT = Infinity,
    maxT = -Infinity
  let minV = Infinity,
    maxV = -Infinity

  for (const graph of graphs) {
    const times = graph.timestamps_ms ?? []
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!
      const v = graph.voltage_levels[i]!
      if (t < minT) minT = t
      if (t > maxT) maxT = t
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
  }

  // Add some padding to V range
  const vRange = maxV - minV
  minV -= vRange * 0.1
  maxV += vRange * 0.1
  if (Math.abs(maxV - minV) < 1e-9) {
    minV -= 1
    maxV += 1
  }

  const tScale = (t: number) =>
    margin.left + ((t - minT) / (maxT - minT)) * plotWidth
  const vScale = (v: number) =>
    margin.top + plotHeight - ((v - minV) / (maxV - minV)) * plotHeight

  const colors = [
    "#1f77b4",
    "#FCD12A",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
  ]

  let paths = ""
  for (let i = 0; i < graphs.length; i++) {
    const graph = graphs[i]!
    const times = graph.timestamps_ms ?? []
    if (times.length === 0) continue
    const d = times
      .map(
        (t, j) =>
          `${j === 0 ? "M" : "L"} ${tScale(t)} ${vScale(
            graph.voltage_levels[j]!,
          )}`,
      )
      .join(" ")

    paths += `<path d="${d}" stroke="${
      colors[i % colors.length]
    }" fill="none" stroke-width="2" />`
  }

  // Axes, title, legend
  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
  svg += `<style>
    .axis { font: 10px sans-serif; }
    .title { font: 16px sans-serif; text-anchor: middle; }
    .legend { font: 12px sans-serif; }
  </style>`
  svg += `<rect width="100%" height="100%" fill="white" />`

  // Title
  if (options.title) {
    svg += `<text x="${width / 2}" y="${
      margin.top / 2
    }" class="title">${options.title}</text>`
  }

  // Plot area box
  svg += `<rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="#ccc" />`

  // X axis
  svg += `<line x1="${margin.left}" y1="${
    height - margin.bottom
  }" x2="${width - margin.right}" y2="${
    height - margin.bottom
  }" stroke="black" />`
  svg += `<text x="${margin.left + plotWidth / 2}" y="${
    height - 10
  }" text-anchor="middle" class="axis">Time (ms)</text>`
  svg += `<text y="${
    height - margin.bottom + 15
  }" x="${margin.left}" text-anchor="middle" class="axis">${minT.toFixed(
    2,
  )}</text>`
  svg += `<text y="${
    height - margin.bottom + 15
  }" x="${width - margin.right}" text-anchor="middle" class="axis">${maxT.toFixed(
    2,
  )}</text>`

  // Y axis
  svg += `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${
    height - margin.bottom
  }" stroke="black" />`
  svg += `<text transform="rotate(-90)" x="${-(
    margin.top +
    plotHeight / 2
  )}" y="15" text-anchor="middle" class="axis">Voltage (V)</text>`
  svg += `<text x="${margin.left - 5}" y="${
    height - margin.bottom
  }" text-anchor="end" class="axis">${minV.toFixed(2)}</text>`
  svg += `<text x="${margin.left - 5}" y="${
    margin.top + 10
  }" text-anchor="end" class="axis">${maxV.toFixed(2)}</text>`

  // paths (rel to svg, not plot area)
  svg += paths

  // Legend
  let legend = ""
  for (let i = 0; i < graphs.length; i++) {
    const graph = graphs[i]!
    legend += `<g transform="translate(${width - margin.right + 10}, ${
      margin.top + i * 20
    })">`
    legend += `<rect x="0" y="0" width="10" height="10" fill="${
      colors[i % colors.length]
    }" />`
    legend += `<text x="15" y="10" class="legend">${
      graph.name ?? `trace ${i}`
    }</text>`
    legend += `</g>`
  }
  svg += legend

  svg += `</svg>`

  return svg
}

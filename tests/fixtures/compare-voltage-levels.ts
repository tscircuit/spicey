import type { SimulationTransientVoltageGraph } from "circuit-json"

type NodeComparison = {
  compared_samples: number
  mean_absolute_difference: number
  max_absolute_difference: number
  reference_max_magnitude: number
  percentage_difference: number
}

type ComparisonResult = {
  overall_average_percentage_difference: number
  nodes: Record<string, NodeComparison>
  unmatched_spicey_nodes: string[]
  unmatched_ngspice_nodes: string[]
}

function normalizeGraphName(name: string) {
  return name.replace(/\s*\(ngspice\)$/i, "").toUpperCase()
}

function createNodeComparison(
  spiceyGraph: SimulationTransientVoltageGraph,
  ngspiceGraph: SimulationTransientVoltageGraph,
): NodeComparison {
  const samples = Math.min(
    spiceyGraph.voltage_levels.length,
    ngspiceGraph.voltage_levels.length,
  )

  let sumAbsoluteDifference = 0
  let maxAbsoluteDifference = 0
  let referenceMaxMagnitude = 0

  for (let i = 0; i < samples; i++) {
    const spiceyValue = spiceyGraph.voltage_levels[i] ?? 0
    const ngspiceValue = ngspiceGraph.voltage_levels[i] ?? 0

    const absoluteDifference = Math.abs(spiceyValue - ngspiceValue)
    if (absoluteDifference > maxAbsoluteDifference) {
      maxAbsoluteDifference = absoluteDifference
    }

    const referenceMagnitude = Math.abs(ngspiceValue)
    if (referenceMagnitude > referenceMaxMagnitude) {
      referenceMaxMagnitude = referenceMagnitude
    }

    sumAbsoluteDifference += absoluteDifference
  }

  const meanAbsoluteDifference = samples
    ? sumAbsoluteDifference / samples
    : maxAbsoluteDifference

  const percentageDifference = (() => {
    if (referenceMaxMagnitude === 0) {
      return meanAbsoluteDifference === 0 ? 0 : 100
    }
    return (meanAbsoluteDifference / referenceMaxMagnitude) * 100
  })()

  const round = (value: number) => Number(value.toFixed(6))

  return {
    compared_samples: samples,
    mean_absolute_difference: round(meanAbsoluteDifference),
    max_absolute_difference: round(maxAbsoluteDifference),
    reference_max_magnitude: round(referenceMaxMagnitude),
    percentage_difference: round(percentageDifference),
  }
}

export function compareVoltageLevels(
  spiceyGraphs: SimulationTransientVoltageGraph[],
  ngspiceGraphs: SimulationTransientVoltageGraph[],
): ComparisonResult {
  const ngspiceGraphMap = new Map(
    ngspiceGraphs.map(
      (graph) =>
        [
          normalizeGraphName(
            graph.name ?? graph.simulation_transient_voltage_graph_id,
          ),
          graph,
        ] as const,
    ),
  )

  const nodes: Record<string, NodeComparison> = {}
  const unmatchedSpiceyNodes: string[] = []
  let totalPercentage = 0
  let countedNodes = 0

  for (const spiceyGraph of spiceyGraphs) {
    const normalizedName = normalizeGraphName(
      spiceyGraph.name ?? spiceyGraph.simulation_transient_voltage_graph_id,
    )
    const ngspiceGraph = ngspiceGraphMap.get(normalizedName)

    if (!ngspiceGraph) {
      unmatchedSpiceyNodes.push(
        spiceyGraph.name ?? spiceyGraph.simulation_transient_voltage_graph_id,
      )
      continue
    }

    const nodeComparison = createNodeComparison(spiceyGraph, ngspiceGraph)
    nodes[normalizedName] = nodeComparison
    totalPercentage += nodeComparison.percentage_difference
    countedNodes += 1
  }

  const unmatchedNgspiceNodes = ngspiceGraphs
    .map((graph) =>
      normalizeGraphName(
        graph.name ?? graph.simulation_transient_voltage_graph_id,
      ),
    )
    .filter((name) => !(name in nodes))

  const overallAveragePercentageDifference = countedNodes
    ? Number((totalPercentage / countedNodes).toFixed(6))
    : 0

  return {
    overall_average_percentage_difference: overallAveragePercentageDifference,
    nodes,
    unmatched_spicey_nodes: unmatchedSpiceyNodes,
    unmatched_ngspice_nodes: unmatchedNgspiceNodes,
  }
}

export type { ComparisonResult, NodeComparison }

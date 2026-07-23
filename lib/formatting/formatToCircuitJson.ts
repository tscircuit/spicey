import type { SimulationAnalysisResult } from "circuit-json"
import { formatAcSweepToCircuitJson } from "./formatAcSweepToCircuitJson"
import {
  createCircuitJsonFormattingContext,
  type SpiceySimulation,
} from "./simulation-result-formatting-helpers"
import { formatDcOperatingPointToCircuitJson } from "./formatDcOperatingPointToCircuitJson"
import { formatDcSweepToCircuitJson } from "./formatDcSweepToCircuitJson"
import { formatTransientToCircuitJson } from "./formatTransientToCircuitJson"

export const spiceySimulationToCircuitJson = ({
  simulation,
  spiceString,
  simulationExperimentId,
}: {
  simulation: SpiceySimulation
  spiceString: string
  simulationExperimentId: string
}): SimulationAnalysisResult[] => {
  const formattingContext = createCircuitJsonFormattingContext({
    simulation,
    spiceString,
    simulationExperimentId,
  })

  return [
    ...formatTransientToCircuitJson(formattingContext),
    ...formatDcOperatingPointToCircuitJson(formattingContext),
    ...formatDcSweepToCircuitJson(formattingContext),
    ...formatAcSweepToCircuitJson(formattingContext),
  ]
}

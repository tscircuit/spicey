import { spiceySimulationToCircuitJson } from "../formatting/formatToCircuitJson"
import { simulate } from "./simulate"

export const simulateToCircuitJson = ({
  spiceString,
  simulationExperimentId,
}: {
  spiceString: string
  simulationExperimentId: string
}) =>
  spiceySimulationToCircuitJson({
    simulation: simulate(spiceString),
    spiceString,
    simulationExperimentId,
  })

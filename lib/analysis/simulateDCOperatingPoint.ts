import { EPS } from "../constants/EPS"
import { VT_300K } from "../constants/physics"
import { solveReal } from "../math/solveReal"
import type { ParsedCircuit } from "../parsing/parseNetlist"
import { stampAdmittanceReal } from "../stamping/stampAdmittanceReal"
import { stampCurrentReal } from "../stamping/stampCurrentReal"
import { stampVoltageSourceReal } from "../stamping/stampVoltageSourceReal"

const dcInductorConductance = 1e9

const getNodeVoltage = ({
  nodeId,
  solution,
}: {
  nodeId: number
  solution: number[]
}) => (nodeId === 0 ? 0 : (solution[nodeId - 1] ?? 0))

const updateSwitchStates = ({
  circuit,
  solution,
}: {
  circuit: ParsedCircuit
  solution: number[]
}) => {
  let changed = false
  for (const simulationSwitch of circuit.S) {
    if (!simulationSwitch.model) continue
    const controlVoltage =
      getNodeVoltage({ nodeId: simulationSwitch.ncPos, solution }) -
      getNodeVoltage({ nodeId: simulationSwitch.ncNeg, solution })
    const nextState = simulationSwitch.isOn
      ? controlVoltage >= simulationSwitch.model.Voff
      : controlVoltage > simulationSwitch.model.Von
    if (nextState !== simulationSwitch.isOn) {
      simulationSwitch.isOn = nextState
      changed = true
    }
  }
  return changed
}

const buildDcLinearSystem = ({
  circuit,
  previousSolution,
}: {
  circuit: ParsedCircuit
  previousSolution: number[]
}) => {
  const nodeVariableCount = circuit.nodes.count() - 1
  const variableCount = nodeVariableCount + circuit.V.length
  const matrix = Array.from({ length: variableCount }, () =>
    new Array(variableCount).fill(0),
  )
  const rightHandSide = new Array(variableCount).fill(0)

  for (const resistor of circuit.R) {
    if (resistor.R <= 0) {
      throw new Error(`R ${resistor.name} must be > 0`)
    }
    stampAdmittanceReal(
      matrix,
      circuit.nodes,
      resistor.n1,
      resistor.n2,
      1 / resistor.R,
    )
  }

  for (const inductor of circuit.L) {
    stampAdmittanceReal(
      matrix,
      circuit.nodes,
      inductor.n1,
      inductor.n2,
      dcInductorConductance,
    )
  }

  for (const simulationSwitch of circuit.S) {
    if (!simulationSwitch.model) continue
    const resistance = simulationSwitch.isOn
      ? simulationSwitch.model.Ron
      : simulationSwitch.model.Roff
    stampAdmittanceReal(
      matrix,
      circuit.nodes,
      simulationSwitch.n1,
      simulationSwitch.n2,
      1 / Math.max(Math.abs(resistance), EPS),
    )
  }

  for (const diode of circuit.D) {
    if (!diode.model) continue
    const diodeVoltage = Math.max(
      -1,
      Math.min(
        0.8,
        getNodeVoltage({ nodeId: diode.nPlus, solution: previousSolution }) -
          getNodeVoltage({ nodeId: diode.nMinus, solution: previousSolution }),
      ),
    )
    const thermalVoltage = diode.model.N * VT_300K
    const exponential = Math.exp(diodeVoltage / thermalVoltage)
    const diodeCurrent = diode.model.Is * (exponential - 1)
    const conductance = Math.max(
      (diode.model.Is / thermalVoltage) * exponential,
      1e-12,
    )
    const equivalentCurrent = diodeCurrent - conductance * diodeVoltage
    stampAdmittanceReal(
      matrix,
      circuit.nodes,
      diode.nPlus,
      diode.nMinus,
      conductance,
    )
    stampCurrentReal(
      rightHandSide,
      circuit.nodes,
      diode.nPlus,
      diode.nMinus,
      equivalentCurrent,
    )
  }

  for (const currentSource of circuit.I) {
    stampCurrentReal(
      rightHandSide,
      circuit.nodes,
      currentSource.n1,
      currentSource.n2,
      currentSource.dc,
    )
  }

  for (const voltageSource of circuit.V) {
    stampVoltageSourceReal(
      matrix,
      rightHandSide,
      circuit.nodes,
      voltageSource,
      voltageSource.dc,
    )
  }

  return { matrix, rightHandSide }
}

export type DcOperatingPointResult = {
  nodeVoltages: Record<string, number>
  elementCurrents: Record<string, number>
}

export const calculateDcOperatingPoint = (
  circuit: ParsedCircuit,
): DcOperatingPointResult => {
  const variableCount = circuit.nodes.count() - 1 + circuit.V.length
  let solution = new Array(variableCount).fill(0)

  for (let iteration = 0; iteration < 50; iteration++) {
    const previousSolution = solution
    const { matrix, rightHandSide } = buildDcLinearSystem({
      circuit,
      previousSolution,
    })
    solution = solveReal(matrix, rightHandSide)
    const switchStateChanged = updateSwitchStates({ circuit, solution })
    let largestChange = 0
    for (
      let solutionVariableIndex = 0;
      solutionVariableIndex < solution.length;
      solutionVariableIndex++
    ) {
      const solutionVariable = solution[solutionVariableIndex] ?? 0
      const previousSolutionVariable =
        previousSolution[solutionVariableIndex] ?? 0
      largestChange = Math.max(
        largestChange,
        Math.abs(solutionVariable - previousSolutionVariable),
      )
    }
    if (!switchStateChanged && largestChange < 1e-9) break
  }

  const nodeVoltages: Record<string, number> = {}
  for (let nodeId = 1; nodeId < circuit.nodes.count(); nodeId++) {
    const nodeName = circuit.nodes.rev[nodeId]
    if (nodeName) {
      nodeVoltages[nodeName] = getNodeVoltage({ nodeId, solution })
    }
  }

  const elementCurrents: Record<string, number> = {}
  for (const resistor of circuit.R) {
    elementCurrents[resistor.name] =
      (getNodeVoltage({ nodeId: resistor.n1, solution }) -
        getNodeVoltage({ nodeId: resistor.n2, solution })) /
      resistor.R
  }
  for (const capacitor of circuit.C) {
    elementCurrents[capacitor.name] = 0
  }
  for (const inductor of circuit.L) {
    elementCurrents[inductor.name] =
      (getNodeVoltage({ nodeId: inductor.n1, solution }) -
        getNodeVoltage({ nodeId: inductor.n2, solution })) *
      dcInductorConductance
  }
  for (const voltageSource of circuit.V) {
    elementCurrents[voltageSource.name] = solution[voltageSource.index] ?? 0
  }
  for (const currentSource of circuit.I) {
    elementCurrents[currentSource.name] = currentSource.dc
  }
  for (const simulationSwitch of circuit.S) {
    if (!simulationSwitch.model) continue
    const resistance = simulationSwitch.isOn
      ? simulationSwitch.model.Ron
      : simulationSwitch.model.Roff
    elementCurrents[simulationSwitch.name] =
      (getNodeVoltage({ nodeId: simulationSwitch.n1, solution }) -
        getNodeVoltage({ nodeId: simulationSwitch.n2, solution })) /
      resistance
  }
  for (const diode of circuit.D) {
    if (!diode.model) continue
    const diodeVoltage =
      getNodeVoltage({ nodeId: diode.nPlus, solution }) -
      getNodeVoltage({ nodeId: diode.nMinus, solution })
    elementCurrents[diode.name] =
      diode.model.Is * (Math.exp(diodeVoltage / (diode.model.N * VT_300K)) - 1)
  }

  return { nodeVoltages, elementCurrents }
}

export const simulateDCOperatingPoint = (circuit: ParsedCircuit) =>
  circuit.analyses.op ? calculateDcOperatingPoint(circuit) : null

import { EPS } from "../constants/EPS"
import { Complex } from "../math/Complex"
import { solveComplex } from "../math/solveComplex"
import type { ParsedCircuit } from "../parsing/parseNetlist"
import { logspace } from "../utils/logspace"
import { stampAdmittanceComplex } from "../stamping/stampAdmittanceComplex"
import { stampCurrentComplex } from "../stamping/stampCurrentComplex"
import { stampVoltageSourceComplex } from "../stamping/stampVoltageSourceComplex"

function getAcFrequenciesHz({
  mode,
  pointsPerInterval,
  startFrequencyHz,
  stopFrequencyHz,
}: {
  mode: "dec" | "lin" | "oct"
  pointsPerInterval: number
  startFrequencyHz: number
  stopFrequencyHz: number
}) {
  if (mode === "dec") {
    return logspace({
      startFrequencyHz,
      stopFrequencyHz,
      pointsPerInterval,
    })
  }
  if (mode === "oct") {
    return logspace({
      startFrequencyHz,
      stopFrequencyHz,
      pointsPerInterval,
      intervalBase: 2,
    })
  }
  const pointCount = Math.max(2, pointsPerInterval)
  const frequencyStepHz =
    (stopFrequencyHz - startFrequencyHz) / (pointCount - 1)
  return Array.from(
    { length: pointCount },
    (_, pointIndex) => startFrequencyHz + pointIndex * frequencyStepHz,
  )
}

function buildLinearSystemForAc({
  circuit,
  frequencyHz,
  variableCount,
}: {
  circuit: ParsedCircuit
  frequencyHz: number
  variableCount: number
}): { matrix: Complex[][]; rightHandSide: Complex[] } {
  const matrix = Array.from({ length: variableCount }, () =>
    Array.from({ length: variableCount }, () => Complex.from(0, 0)),
  )
  const rightHandSide = Array.from({ length: variableCount }, () =>
    Complex.from(0, 0),
  )

  const twoPi = 2 * Math.PI

  for (const resistor of circuit.R) {
    if (resistor.R <= 0) {
      throw new Error(`R ${resistor.name} must be > 0`)
    }
    const admittance = Complex.from(1 / resistor.R, 0)
    stampAdmittanceComplex(
      matrix,
      circuit.nodes,
      resistor.n1,
      resistor.n2,
      admittance,
    )
  }

  for (const capacitor of circuit.C) {
    const admittance = Complex.from(0, twoPi * frequencyHz * capacitor.C)
    stampAdmittanceComplex(
      matrix,
      circuit.nodes,
      capacitor.n1,
      capacitor.n2,
      admittance,
    )
  }

  for (const inductor of circuit.L) {
    const impedance = Complex.from(0, twoPi * frequencyHz * inductor.L)
    const admittance =
      impedance.abs() < EPS
        ? Complex.from(0, 0)
        : Complex.from(1, 0).div(impedance)
    stampAdmittanceComplex(
      matrix,
      circuit.nodes,
      inductor.n1,
      inductor.n2,
      admittance,
    )
  }

  for (const currentSource of circuit.I) {
    const currentPhasor = Complex.fromPolar(
      currentSource.acMag,
      currentSource.acPhaseDeg,
    )
    stampCurrentComplex(
      rightHandSide,
      circuit.nodes,
      currentSource.n1,
      currentSource.n2,
      currentPhasor,
    )
  }

  for (const voltageSource of circuit.V) {
    const voltagePhasor = Complex.fromPolar(
      voltageSource.acMag || 0,
      voltageSource.acPhaseDeg || 0,
    )
    stampVoltageSourceComplex(
      matrix,
      rightHandSide,
      circuit.nodes,
      voltageSource,
      voltagePhasor,
    )
  }

  return { matrix, rightHandSide }
}

function simulateAC(circuit: ParsedCircuit) {
  if (!circuit.analyses.ac) return null

  const { mode, N, f1, f2 } = circuit.analyses.ac
  const nodeVariableCount = circuit.nodes.count() - 1
  const variableCount = nodeVariableCount + circuit.V.length

  const frequenciesHz = getAcFrequenciesHz({
    mode,
    pointsPerInterval: N,
    startFrequencyHz: f1,
    stopFrequencyHz: f2,
  })

  const nodeVoltages: Record<string, Complex[]> = {}
  circuit.nodes.rev.forEach((nodeName, nodeId) => {
    if (nodeId !== 0) nodeVoltages[nodeName] = []
  })
  const elementCurrents: Record<string, Complex[]> = {}

  const twoPi = 2 * Math.PI

  for (const frequencyHz of frequenciesHz) {
    const { matrix, rightHandSide } = buildLinearSystemForAc({
      circuit,
      frequencyHz,
      variableCount,
    })

    const solution = solveComplex(matrix, rightHandSide)

    for (let nodeId = 1; nodeId < circuit.nodes.count(); nodeId++) {
      const nodeVariableIndex = nodeId - 1
      const nodeName = circuit.nodes.rev[nodeId]
      if (!nodeName) continue
      const series = nodeVoltages[nodeName]
      if (!series) continue
      series.push(solution[nodeVariableIndex] ?? Complex.from(0, 0))
    }

    for (const resistor of circuit.R) {
      const v1 =
        resistor.n1 === 0
          ? Complex.from(0, 0)
          : (solution[resistor.n1 - 1] ?? Complex.from(0, 0))
      const v2 =
        resistor.n2 === 0
          ? Complex.from(0, 0)
          : (solution[resistor.n2 - 1] ?? Complex.from(0, 0))
      const admittance = Complex.from(1 / resistor.R, 0)
      const current = admittance.mul(v1.sub(v2))
      ;(elementCurrents[resistor.name] ||= []).push(current)
    }
    for (const capacitor of circuit.C) {
      const v1 =
        capacitor.n1 === 0
          ? Complex.from(0, 0)
          : (solution[capacitor.n1 - 1] ?? Complex.from(0, 0))
      const v2 =
        capacitor.n2 === 0
          ? Complex.from(0, 0)
          : (solution[capacitor.n2 - 1] ?? Complex.from(0, 0))
      const admittance = Complex.from(0, twoPi * frequencyHz * capacitor.C)
      const current = admittance.mul(v1.sub(v2))
      ;(elementCurrents[capacitor.name] ||= []).push(current)
    }
    for (const inductor of circuit.L) {
      const v1 =
        inductor.n1 === 0
          ? Complex.from(0, 0)
          : (solution[inductor.n1 - 1] ?? Complex.from(0, 0))
      const v2 =
        inductor.n2 === 0
          ? Complex.from(0, 0)
          : (solution[inductor.n2 - 1] ?? Complex.from(0, 0))
      const impedance = Complex.from(0, twoPi * frequencyHz * inductor.L)
      const admittance =
        impedance.abs() < EPS
          ? Complex.from(0, 0)
          : Complex.from(1, 0).div(impedance)
      const current = admittance.mul(v1.sub(v2))
      ;(elementCurrents[inductor.name] ||= []).push(current)
    }
    for (const voltageSource of circuit.V) {
      const current = solution[voltageSource.index] ?? Complex.from(0, 0)
      ;(elementCurrents[voltageSource.name] ||= []).push(current)
    }
    for (const currentSource of circuit.I) {
      ;(elementCurrents[currentSource.name] ||= []).push(
        Complex.fromPolar(currentSource.acMag, currentSource.acPhaseDeg),
      )
    }
  }

  return { freqs: frequenciesHz, nodeVoltages, elementCurrents }
}

export { simulateAC }

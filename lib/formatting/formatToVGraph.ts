import { EPS } from "../constants/EPS"
import type { ParsedCircuit } from "../parsing/parseNetlist"
import type { simulateTRAN } from "../analysis/simulateTRAN"
import type { SimulationTransientVoltageGraph } from "circuit-json"

// Assuming a hypothetical output format for eecircuit-engine
export type EecEngineTranResult = {
  time_s: number[]
  voltages: Record<string, number[]>
}

export function spiceyTranToVGraphs(
  tranResult: ReturnType<typeof simulateTRAN>,
  ckt: ParsedCircuit,
  simulation_experiment_id: string,
): SimulationTransientVoltageGraph[] {
  if (!tranResult || !ckt.analyses.tran) return []

  const { dt, tstop } = ckt.analyses.tran
  const { times, nodeVoltages } = tranResult

  const graphs: SimulationTransientVoltageGraph[] = []

  for (const nodeName in nodeVoltages) {
    const voltage_levels = nodeVoltages[nodeName]!
    graphs.push({
      type: "simulation_transient_voltage_graph",
      simulation_transient_voltage_graph_id: `stvg_${simulation_experiment_id}_${nodeName}`, // simple id
      simulation_experiment_id,
      timestamps_ms: times.map((t) => t * 1000),
      voltage_levels,
      time_per_step: dt * 1000,
      start_time_ms: 0,
      end_time_ms: tstop * 1000,
      name: `V(${nodeName})`,
    })
  }

  return graphs
}

export function eecEngineTranToVGraphs(
  tranResult: EecEngineTranResult,
  ckt: ParsedCircuit, // for dt/tstop
  simulation_experiment_id: string,
): SimulationTransientVoltageGraph[] {
  if (!ckt.analyses.tran) return []
  const { dt, tstop } = ckt.analyses.tran

  const graphs: SimulationTransientVoltageGraph[] = []

  const sourceTimes = tranResult.time_s
  const targetTimes: number[] = []
  if (dt > EPS) {
    const steps = Math.max(1, Math.round(tstop / dt))
    for (let step = 0; step <= steps; step++) {
      const t = Math.min(step * dt, tstop)
      targetTimes.push(t)
    }
  } else {
    targetTimes.push(...sourceTimes)
  }

  const resampleVoltages = (values: number[]) => {
    if (targetTimes.length === sourceTimes.length && dt <= EPS)
      return values.slice()

    const out: number[] = []
    let srcIdx = 0
    const lastIdx = sourceTimes.length - 1
    for (const target of targetTimes) {
      if (lastIdx < 0) {
        out.push(0)
        continue
      }
      if (target <= sourceTimes[0]! + EPS) {
        out.push(values[0] ?? 0)
        continue
      }
      if (target >= sourceTimes[lastIdx]! - EPS) {
        out.push(values[lastIdx] ?? values[lastIdx - 1] ?? 0)
        continue
      }
      while (
        srcIdx + 1 < sourceTimes.length &&
        sourceTimes[srcIdx + 1]! <= target
      ) {
        srcIdx++
      }
      const t1 = sourceTimes[srcIdx] ?? target
      const v1 = values[srcIdx] ?? 0
      const t2 = sourceTimes[srcIdx + 1]
      const v2 = values[srcIdx + 1]
      if (t2 == null || t2 <= t1 + EPS) {
        out.push(v1)
      } else {
        const alpha = (target - t1) / (t2 - t1)
        const vNext = v2 ?? v1
        out.push(v1 + alpha * (vNext - v1))
      }
    }
    return out
  }

  for (const nodeName in tranResult.voltages) {
    const voltage_levels = resampleVoltages(
      tranResult.voltages[nodeName]! || [],
    )
    graphs.push({
      type: "simulation_transient_voltage_graph",
      simulation_transient_voltage_graph_id: `stvg_${simulation_experiment_id}_${nodeName}_eec`,
      simulation_experiment_id,
      timestamps_ms: targetTimes.map((t) => t * 1000),
      voltage_levels,
      time_per_step:
        dt > EPS
          ? dt * 1000
          : targetTimes.length > 1
            ? (targetTimes[1]! - targetTimes[0]!) * 1000
            : 0,
      start_time_ms: 0,
      end_time_ms: tstop * 1000,
      name: `V(${nodeName}) (ngspice)`,
    })
  }
  return graphs
}

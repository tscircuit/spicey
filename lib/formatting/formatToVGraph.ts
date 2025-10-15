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

  for (const nodeName in tranResult.voltages) {
    const voltage_levels = tranResult.voltages[nodeName]!
    graphs.push({
      type: "simulation_transient_voltage_graph",
      simulation_transient_voltage_graph_id: `stvg_${simulation_experiment_id}_${nodeName}_eec`,
      simulation_experiment_id,
      timestamps_ms: tranResult.time_s.map((t) => t * 1000),
      voltage_levels,
      time_per_step: dt * 1000,
      start_time_ms: 0,
      end_time_ms: tstop * 1000,
      name: `V(${nodeName}) (ngspice)`,
    })
  }
  return graphs
}

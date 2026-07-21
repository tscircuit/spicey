# spicey

Run [SPICE](https://en.wikipedia.org/wiki/SPICE) simulations in native javascript. An alternative to [ngspice](https://ngspice.sourceforge.io/)

[![npm version](https://img.shields.io/npm/v/spicey.svg)](https://www.npmjs.com/package/spicey)

```tsx
import { simulate, formatAcResult } from "spicey"

const net1 = `
Demo of a simple AC circuit

v1 1 0 dc 0 ac 1
r1 1 2 30
c1 2 0 100u
.ac dec 100 1 100

.end
`

const result1 = simulate(net1)

formatAcResult(result1.ac)
`
  "f(Hz), 1:|V|,∠V(deg), 2:|V|,∠V(deg)
  1.00000, 1.00000,0.00000, 0.999822,-1.07987
  1.02329, 1.00000,0.00000, 0.999814,-1.10502
  1.04713, 1.00000,0.00000, 0.999805,-1.13075
  1.07152, 1.00000,0.00000, 0.999796,-1.15708
  1.09648, 1.00000,0.00000, 0.999786,-1.18403
  1.12202, 1.00000,0.00000, 0.999776,-1.21160
  1.14815, 1.00000,0.00000, 0.999766,-1.23981
  1.17490, 1.00000,0.00000, 0.999755,-1.26868
  1.20226, 1.00000,0.00000, 0.999743,-1.29822
  ..."
`)
```

## Supported analyses

`simulate` supports transient (`.tran`), DC operating point (`.op`), DC source
sweep (`.dc`), and AC sweep (`.ac lin`, `.ac dec`, and `.ac oct`) analyses.
Independent voltage and current sources support DC, AC magnitude/phase, PULSE,
and PWL specifications.

Use `simulateToCircuitJson` when the result should use tscircuit's
analysis-specific Circuit JSON elements:

```ts
import { simulateToCircuitJson } from "spicey"

const simulationResultCircuitJson = simulateToCircuitJson({
  spiceString: `
V1 in 0 DC 0
R1 in out 1k
R2 out 0 1k
.PRINT DC V(out) I(V1)
.dc V1 0 5 1
.end
`,
  simulationExperimentId: "simulation_experiment_0",
})
```

## Proposed directory structure

To make it easy to extend the simulator (for example to add transistor models later), the library is now organized into focused modules:

```
lib/
  analysis/            # High-level simulation entry points (simulate, simulateAC, simulateTRAN)
  constants/           # Shared numeric constants
  formatting/          # Result formatting helpers
  math/                # Numeric utilities such as Complex arithmetic and matrix solvers
  parsing/             # Netlist parsing and circuit data structures
  stamping/            # Matrix/RHS stamping helpers for modified nodal analysis
  utils/               # Generic helpers (e.g., logarithmic sweeps)
```

Each exported function lives in its own file with a matching name, so new capabilities can be added without creating monolithic modules.

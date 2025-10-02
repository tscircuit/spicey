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

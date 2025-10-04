import { test, expect } from "bun:test"
import { simulate } from "lib/index"

const tranBiasNetlist = `
* Simple small-signal transistor bias network
VCC vcc 0 DC 10
VIN vin 0 DC 0.1
RB vin b 100k
RC vcc c 10k
Q1 c b 0 GM=0.01 RPI=20k RO=100k

.tran 1u 1u

.end
`

test("transistor01: dc bias with small-signal model", () => {
  const result = simulate(tranBiasNetlist)
  if (!result.tran) throw new Error("Transient result missing")

  const vb = result.tran.nodeVoltages["b"]?.at(-1)
  const vc = result.tran.nodeVoltages["c"]?.at(-1)
  const ic = result.tran.elementCurrents["Q1"]?.at(-1)

  expect(vb).toBeDefined()
  expect(vc).toBeDefined()
  expect(ic).toBeDefined()

  expect(vb!).toBeCloseTo(0.0166666, 6)
  expect(vc!).toBeCloseTo(7.5757575, 6)
  expect(ic!).toBeCloseTo(0.000242424, 9)
})

const acAmplifierNetlist = `
* AC gain using linear transistor parameters
VIN in 0 AC 1
RB in b 100k
RC 1 c 10k
QGAIN c b 0 GM=0.01 RPI=20k RO=100k
VCC 1 0 DC 10

.ac lin 1 1k 1k

.end
`

test("transistor01: ac gain matches expected small-signal solution", () => {
  const result = simulate(acAmplifierNetlist)
  if (!result.ac) throw new Error("AC result missing")

  const vb = result.ac.nodeVoltages["b"]?.[0]
  const vc = result.ac.nodeVoltages["c"]?.[0]

  expect(vb).toBeDefined()
  expect(vc).toBeDefined()

  expect(vb!.re).toBeCloseTo(0.1666666, 6)
  expect(vb!.im).toBeCloseTo(0, 6)
  expect(vc!.re).toBeCloseTo(-15.151515, 5)
  expect(vc!.im).toBeCloseTo(0, 6)
})

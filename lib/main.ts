/*------------------------------------------------------------------------------
  Simple SPICE in native JavaScript
  - AC sweep (.ac dec/lin) for R, L, C, independent V sources
  - Transient (.tran) with backward-Euler for R, L, C, independent V sources
  - PULSE() and DC for time-domain independent V sources; AC <mag> [phase] for AC
  - Minimal, educational, not a full SPICE (no nonlinear devices, no .op, etc.)
------------------------------------------------------------------------------*/

// ------------------------ Utilities ------------------------

const EPS = 1e-15

const unitMul = {
  // SPICE-style suffixes (case-insensitive)
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
}

function parseNumberWithUnits(raw) {
  if (raw == null) return NaN
  let s = String(raw).trim()
  if (s === "") return NaN

  // If it's a plain number (possibly scientific notation), parse directly.
  if (/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(s)) return parseFloat(s)

  // E.g., "100u", "10k", "1.8V", "0.09u", "1meg", "100uF"
  const m = s.match(/^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)([a-zA-Z]+)$/)
  if (!m) return parseFloat(s) // last-ditch attempt; may produce NaN

  let val = parseFloat(m[1])
  let suf = m[2].toLowerCase()

  // Strip dimension letters like 'f','h','v','a','s','ohm' if appended to suffix
  // so "100uF" -> "u", "1kOhm" -> "k".
  suf = suf.replace(/(ohm|v|a|s|h|f)$/g, "")

  if (suf === "meg") return val * unitMul.meg
  if (suf.length === 1 && unitMul.hasOwnProperty(suf)) return val * unitMul[suf]

  // Unknown suffix -> just parse number part.
  return val
}

// Tokenizer that keeps parenthesis groups intact, e.g. PULSE(...) as one token
function smartTokens(line) {
  const re = /"[^"]*"|\([^()]*\)|\S+/g
  const out = []
  let m
  while ((m = re.exec(line)) !== null) out.push(m[0])
  return out
}

// Log-spaced frequencies for .ac dec
function logspace(f1, f2, pointsPerDec) {
  if (f1 <= 0 || f2 <= 0) throw new Error(".ac frequencies must be > 0")
  if (f2 < f1) [f1, f2] = [f2, f1]
  const decades = Math.log10(f2 / f1)
  const n = Math.max(1, Math.ceil(decades * pointsPerDec))
  const arr = []
  for (let i = 0; i <= n; i++) {
    arr.push(f1 * Math.pow(10, i / pointsPerDec))
  }
  // Ensure last point ≤ f2 (and include f2 if needed)
  if (arr[arr.length - 1] < f2 * (1 - 1e-12)) arr.push(f2)
  return arr
}

// ------------------------ Complex numbers ------------------------

class Complex {
  constructor(re = 0, im = 0) {
    this.re = re
    this.im = im
  }
  static from(re, im = 0) {
    return new Complex(re, im)
  }
  static fromPolar(mag, deg = 0) {
    const ph = (deg * Math.PI) / 180
    return new Complex(mag * Math.cos(ph), mag * Math.sin(ph))
  }
  clone() {
    return new Complex(this.re, this.im)
  }
  add(b) {
    return new Complex(this.re + b.re, this.im + b.im)
  }
  sub(b) {
    return new Complex(this.re - b.re, this.im - b.im)
  }
  mul(b) {
    return new Complex(
      this.re * b.re - this.im * b.im,
      this.re * b.im + this.im * b.re,
    )
  }
  div(b) {
    const d = b.re * b.re + b.im * b.im
    if (d < EPS) throw new Error("Complex divide by ~0")
    return new Complex(
      (this.re * b.re + this.im * b.im) / d,
      (this.im * b.re - this.re * b.im) / d,
    )
  }
  inv() {
    const d = this.re * this.re + this.im * this.im
    if (d < EPS) throw new Error("Complex invert by ~0")
    return new Complex(this.re / d, -this.im / d)
  }
  abs() {
    return Math.hypot(this.re, this.im)
  }
  phaseDeg() {
    return (Math.atan2(this.im, this.re) * 180) / Math.PI
  }
}

// ------------------------ Linear solvers ------------------------

function solveReal(A, b) {
  // Gaussian elimination with partial pivoting
  const n = A.length
  // Build augmented matrix
  for (let i = 0; i < n; i++) {
    A[i] = A[i].slice() // clone row
    A[i].push(b[i])
  }

  for (let k = 0; k < n; k++) {
    // Pivot
    let imax = k
    let vmax = Math.abs(A[k][k])
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i][k])
      if (v > vmax) {
        vmax = v
        imax = i
      }
    }
    if (vmax < EPS) throw new Error("Singular matrix (real)")

    if (imax !== k) {
      const tmp = A[k]
      A[k] = A[imax]
      A[imax] = tmp
    }

    // Eliminate
    const pivot = A[k][k]
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / pivot
      if (Math.abs(f) < EPS) continue
      for (let j = k; j <= n; j++) A[i][j] -= f * A[k][j]
    }
  }

  // Back substitution
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n]
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]
    x[i] = s / A[i][i]
  }
  return x
}

function solveComplex(A, b) {
  const n = A.length
  // Augment
  for (let i = 0; i < n; i++) {
    A[i] = A[i].map((z) => (z.clone ? z.clone() : Complex.from(z, 0)))
    A[i].push(b[i].clone ? b[i].clone() : Complex.from(b[i], 0))
  }
  // GE with partial pivoting on |pivot|
  for (let k = 0; k < n; k++) {
    let imax = k,
      vmax = A[k][k].abs()
    for (let i = k + 1; i < n; i++) {
      const v = A[i][k].abs()
      if (v > vmax) {
        vmax = v
        imax = i
      }
    }
    if (vmax < EPS) throw new Error("Singular matrix (complex)")
    if (imax !== k) {
      const tmp = A[k]
      A[k] = A[imax]
      A[imax] = tmp
    }

    const pivot = A[k][k]
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k].div(pivot)
      if (f.abs() < EPS) continue
      for (let j = k; j <= n; j++) A[i][j] = A[i][j].sub(f.mul(A[k][j]))
    }
  }
  // Back substitute
  const x = new Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n]
    for (let j = i + 1; j < n; j++) s = s.sub(A[i][j].mul(x[j]))
    x[i] = s.div(A[i][i])
  }
  return x
}

// ------------------------ Circuit & parsing ------------------------

class NodeIndex {
  constructor() {
    this.map = new Map([["0", 0]]) // ground
    this.rev = ["0"]
  }
  getOrCreate(name) {
    const key = String(name)
    if (this.map.has(key)) return this.map.get(key)
    const idx = this.rev.length
    this.map.set(key, idx)
    this.rev.push(key)
    return idx
  }
  get(name) {
    return this.map.get(String(name))
  }
  count() {
    return this.rev.length
  }
  // For MNA unknowns, ground (0) is removed; nodes 1..N-1 map to indices 0..N-2
  matrixIndexOfNode(nodeId) {
    if (nodeId === 0) return -1
    return nodeId - 1
  }
}

// Waveforms (time-domain)
function parsePulseArgs(s) {
  // PULSE (V1 V2 TD TR TF TON PERIOD [Ncycles])
  const clean = s.trim().replace(/^pulse\s*\(/i, "(")
  const inside = clean.replace(/^\(/, "").replace(/\)$/, "").trim()
  const parts = inside.split(/[\s,]+/).filter((x) => x.length)
  if (parts.length < 7) throw new Error("PULSE(...) requires 7 or 8 args")
  const vals = parts.map(parseNumberWithUnits)
  return {
    v1: vals[0],
    v2: vals[1],
    td: vals[2],
    tr: vals[3],
    tf: vals[4],
    ton: vals[5],
    period: vals[6],
    ncycles: parts[7] != null ? vals[7] : Infinity,
  }
}

function pulseValue(p, t) {
  if (t < p.td) return p.v1
  const tt = t - p.td
  const cyclesDone = Math.floor(tt / p.period)
  if (cyclesDone >= p.ncycles) return p.v1
  const tc = tt - cyclesDone * p.period

  if (tc < p.tr) {
    // rise
    const a = tc / Math.max(p.tr, EPS)
    return p.v1 + (p.v2 - p.v1) * a
  } else if (tc < p.tr + p.ton) {
    // on
    return p.v2
  } else if (tc < p.tr + p.ton + p.tf) {
    // fall
    const a = (tc - (p.tr + p.ton)) / Math.max(p.tf, EPS)
    return p.v2 + (p.v1 - p.v2) * a
  } else {
    // off
    return p.v1
  }
}

class Circuit {
  constructor() {
    this.nodes = new NodeIndex()
    this.R = [] // {name,n1,n2,R}
    this.C = [] // {name,n1,n2,C,vPrev}
    this.L = [] // {name,n1,n2,L,iPrev}
    this.V = [] // {name,n1,n2,dc,acMag,acPhaseDeg,waveform, index}
    this.analyses = { ac: null, tran: null }
    this.skipped = [] // lines/devices not supported
  }
  nodeId(n) {
    return this.nodes.getOrCreate(n)
  }
  nodeNameById(id) {
    return this.nodes.rev[id]
  }

  addRes(name, n1, n2, val) {
    this.R.push({ name, n1, n2, R: val })
  }
  addCap(name, n1, n2, val) {
    this.C.push({ name, n1, n2, C: val, vPrev: 0 })
  }
  addInd(name, n1, n2, val) {
    this.L.push({ name, n1, n2, L: val, iPrev: 0 })
  }
  addVsrc(name, n1, n2, spec) {
    const vs = Object.assign(
      {
        name,
        n1,
        n2,
        dc: 0,
        acMag: 0,
        acPhaseDeg: 0,
        waveform: null,
        index: -1,
      },
      spec || {},
    )
    this.V.push(vs)
  }
}

function parseNetlist(text) {
  const ckt = new Circuit()
  const lines = text.split(/\r?\n/)
  let seenTitle = false

  for (let raw of lines) {
    let line = raw.trim()
    if (!line) continue

    // Kill full-line '*' comments
    if (/^\*/.test(line)) continue

    // Stop at .end (still allow trailing whitespace)
    if (/^\s*\.end\b/i.test(line)) break

    // Strip inline comments after '//' or ';' (not SPICE standard, but convenient)
    line = line.replace(/\/\/.*$/, "")
    line = line.replace(/;.*$/, "")

    const tokens = smartTokens(line)
    if (tokens.length === 0) continue

    const first = tokens[0]

    // Title line: allowed to be any free text if first non-empty line and not element/directive
    if (!seenTitle && !/^[rclvgmiqd]\w*$/i.test(first) && !/^\./.test(first)) {
      seenTitle = true
      continue
    }

    // Directives
    if (/^\./.test(first)) {
      const dir = first.toLowerCase()
      if (dir === ".ac") {
        // .ac {dec|lin} N fstart fstop
        const mode = tokens[1]?.toLowerCase()
        if (mode !== "dec" && mode !== "lin")
          throw new Error(".ac supports 'dec' or 'lin'")
        const N = parseInt(tokens[2], 10)
        const f1 = parseNumberWithUnits(tokens[3])
        const f2 = parseNumberWithUnits(tokens[4])
        ckt.analyses.ac = { mode, N, f1, f2 }
      } else if (dir === ".tran") {
        // .tran tstep tstop [tstart ...] -> we use first two
        const dt = parseNumberWithUnits(tokens[1])
        const tstop = parseNumberWithUnits(tokens[2])
        ckt.analyses.tran = { dt, tstop }
      } else if (
        dir === ".include" ||
        dir === ".lib" ||
        dir === ".model" ||
        dir === ".options" ||
        dir === ".op"
      ) {
        ckt.skipped.push(line)
      } else {
        ckt.skipped.push(line)
      }
      continue
    }

    // Elements: R, C, L, V (independent V)
    const typeChar = first[0].toLowerCase()
    const name = first

    try {
      if (typeChar === "r") {
        // Rname n1 n2 value
        const n1 = ckt.nodeId(tokens[1])
        const n2 = ckt.nodeId(tokens[2])
        const val = parseNumberWithUnits(tokens[3])
        ckt.addRes(name, n1, n2, val)
      } else if (typeChar === "c") {
        const n1 = ckt.nodeId(tokens[1])
        const n2 = ckt.nodeId(tokens[2])
        const val = parseNumberWithUnits(tokens[3])
        ckt.addCap(name, n1, n2, val)
      } else if (typeChar === "l") {
        const n1 = ckt.nodeId(tokens[1])
        const n2 = ckt.nodeId(tokens[2])
        const val = parseNumberWithUnits(tokens[3])
        ckt.addInd(name, n1, n2, val)
      } else if (typeChar === "v") {
        // Vname n+ n- [<DC value>] [dc <val>] [ac <mag> [phase]] [pulse (...)]
        const n1 = ckt.nodeId(tokens[1])
        const n2 = ckt.nodeId(tokens[2])
        let spec = { dc: 0, acMag: 0, acPhaseDeg: 0, waveform: null }

        // Flexible scan of the remainder
        let i = 3
        if (i < tokens.length && !/^[a-zA-Z]/.test(tokens[i])) {
          // Bare value = DC
          spec.dc = parseNumberWithUnits(tokens[i])
          i++
        }
        while (i < tokens.length) {
          const key = tokens[i].toLowerCase()
          if (key === "dc") {
            spec.dc = parseNumberWithUnits(tokens[i + 1])
            i += 2
          } else if (key === "ac") {
            spec.acMag = parseNumberWithUnits(tokens[i + 1])
            if (i + 2 < tokens.length && /^[+-]?\d/.test(tokens[i + 2])) {
              spec.acPhaseDeg = parseNumberWithUnits(tokens[i + 2])
              i += 3
            } else {
              i += 2
            }
          } else if (key.startsWith("pulse")) {
            // Could be "pulse(...)" in one token or "pulse" + "(...)"
            let argToken = key.includes("(") ? key : tokens[i + 1]
            if (!argToken || !/\(.*\)/.test(argToken)) {
              throw new Error("Malformed PULSE() specification")
            }
            const p = parsePulseArgs(argToken)
            spec.waveform = (t) => pulseValue(p, t)
            i += key.includes("(") ? 1 : 2
          } else if (/^\(.*\)$/.test(key)) {
            // Lone "(...)" immediately after pulse
            i++
          } else {
            // Unrecognized -> stop scanning (to be permissive)
            i++
          }
        }
        ckt.addVsrc(name, n1, n2, spec)
      } else {
        // Unknown device (M, D, I, etc.)
        ckt.skipped.push(line)
      }
    } catch (e) {
      throw new Error(`Parse error on line: "${line}"\n${e.message}`)
    }
  }

  // Assign MNA indices to voltage sources (branch currents)
  const nNodes = ckt.nodes.count() - 1 // excluding ground
  for (let i = 0; i < ckt.V.length; i++) {
    ckt.V[i].index = nNodes + i
  }
  return ckt
}

// ------------------------ Stamping helpers ------------------------

// Add admittance Y (real) between n1-n2 (node ids) into real matrix
function stampY_real(A, nidx, n1, n2, Y) {
  const i1 = nidx.matrixIndexOfNode(n1)
  const i2 = nidx.matrixIndexOfNode(n2)
  if (i1 >= 0) A[i1][i1] += Y
  if (i2 >= 0) A[i2][i2] += Y
  if (i1 >= 0 && i2 >= 0) {
    A[i1][i2] -= Y
    A[i2][i1] -= Y
  }
}

// Add admittance Y (complex) between n1-n2 into complex matrix
function stampY_cplx(A, nidx, n1, n2, Y) {
  const i1 = nidx.matrixIndexOfNode(n1)
  const i2 = nidx.matrixIndexOfNode(n2)
  if (i1 >= 0) A[i1][i1] = A[i1][i1].add(Y)
  if (i2 >= 0) A[i2][i2] = A[i2][i2].add(Y)
  if (i1 >= 0 && i2 >= 0) {
    A[i1][i2] = A[i1][i2].sub(Y)
    A[i2][i1] = A[i2][i1].sub(Y)
  }
}

// Stamp current source I from nPlus to nMinus into real RHS
function stampI_real(b, nidx, nPlus, nMinus, I) {
  const iPlus = nidx.matrixIndexOfNode(nPlus)
  const iMinus = nidx.matrixIndexOfNode(nMinus)
  if (iPlus >= 0) b[iPlus] -= I
  if (iMinus >= 0) b[iMinus] += I
}

// Stamp current source (complex) into complex RHS
function stampI_cplx(b, nidx, nPlus, nMinus, I) {
  const iPlus = nidx.matrixIndexOfNode(nPlus)
  const iMinus = nidx.matrixIndexOfNode(nMinus)
  if (iPlus >= 0) b[iPlus] = b[iPlus].sub(I)
  if (iMinus >= 0) b[iMinus] = b[iMinus].add(I)
}

// Stamp independent voltage source (MNA) into real A,b, with value V (real)
function stampVsrc_real(A, b, nidx, vs, V, totalUnknowns) {
  const i1 = nidx.matrixIndexOfNode(vs.n1)
  const i2 = nidx.matrixIndexOfNode(vs.n2)
  const j = vs.index // global unknown index (includes node vars)
  // Ensure matrix has room
  // KCL rows:
  if (i1 >= 0) A[i1][j] += 1
  if (i2 >= 0) A[i2][j] -= 1
  // Source equation row
  A[j][j] += 0 // keep for clarity
  if (i1 >= 0) A[j][i1] += 1
  if (i2 >= 0) A[j][i2] -= 1
  b[j] += V
}

// Stamp independent voltage source into complex A,b, with value V (Complex)
function stampVsrc_cplx(A, b, nidx, vs, V) {
  const i1 = nidx.matrixIndexOfNode(vs.n1)
  const i2 = nidx.matrixIndexOfNode(vs.n2)
  const j = vs.index
  if (i1 >= 0) A[i1][j] = A[i1][j].add(Complex.from(1, 0))
  if (i2 >= 0) A[i2][j] = A[i2][j].sub(Complex.from(1, 0))
  if (i1 >= 0) A[j][i1] = A[j][i1].add(Complex.from(1, 0))
  if (i2 >= 0) A[j][i2] = A[j][i2].sub(Complex.from(1, 0))
  b[j] = b[j].add(V)
}

// ------------------------ Analyses ------------------------

function simulateAC(ckt) {
  if (!ckt.analyses.ac) return null

  const { mode, N, f1, f2 } = ckt.analyses.ac
  const nNodeVars = ckt.nodes.count() - 1 // exclude ground
  const nVsrc = ckt.V.length
  const Nvar = nNodeVars + nVsrc

  const freqs =
    mode === "dec"
      ? logspace(f1, f2, N)
      : (function () {
          const arr = []
          const npts = Math.max(2, N)
          const step = (f2 - f1) / (npts - 1)
          for (let i = 0; i < npts; i++) arr.push(f1 + i * step)
          return arr
        })()

  // Results: nodeName -> array of Complex; element currents map likewise
  const Vout = {}
  ckt.nodes.rev.forEach((name, id) => {
    if (id !== 0) Vout[name] = []
  })
  const Ielts = {} // element currents (Res, Cap, Ind, Vsrc) by name

  const twoPi = 2 * Math.PI

  for (const f of freqs) {
    // Build complex matrix A (Nvar x Nvar) and RHS b (Nvar)
    const A = Array.from({ length: Nvar }, () =>
      Array.from({ length: Nvar }, () => Complex.from(0, 0)),
    )
    const b = Array.from({ length: Nvar }, () => Complex.from(0, 0))

    // R stamp: Y = 1/R
    for (const r of ckt.R) {
      if (r.R <= 0) throw new Error(`R ${r.name} must be > 0`)
      const Y = Complex.from(1 / r.R, 0)
      stampY_cplx(A, ckt.nodes, r.n1, r.n2, Y)
    }

    // C stamp: Y = j*omega*C
    for (const c of ckt.C) {
      const Y = Complex.from(0, twoPi * f * c.C) // jωC
      stampY_cplx(A, ckt.nodes, c.n1, c.n2, Y)
    }

    // L stamp: Y = 1/(j*omega*L)
    for (const l of ckt.L) {
      const denom = Complex.from(0, twoPi * f * l.L) // jωL
      const Y =
        denom.abs() < EPS ? Complex.from(0, 0) : Complex.from(1, 0).div(denom) // 1/(jωL)
      stampY_cplx(A, ckt.nodes, l.n1, l.n2, Y)
    }

    // V sources: include ALL voltage sources in AC. DC-only become zero amplitude (=short in small-signal).
    for (const vs of ckt.V) {
      const Vph = Complex.fromPolar(vs.acMag || 0, vs.acPhaseDeg || 0)
      stampVsrc_cplx(A, b, ckt.nodes, vs, Vph)
    }

    // Solve
    const x = solveComplex(A, b)

    // Extract node voltages
    for (let id = 1; id < ckt.nodes.count(); id++) {
      const idx = id - 1
      Vout[ckt.nodeNameById(id)].push(x[idx])
    }

    // Element currents (phasors)
    // R, C, L via I = Y * (v1 - v2); Vsrc via branch current x[j]
    for (const r of ckt.R) {
      const v1 = r.n1 === 0 ? Complex.from(0, 0) : x[r.n1 - 1]
      const v2 = r.n2 === 0 ? Complex.from(0, 0) : x[r.n2 - 1]
      const Y = Complex.from(1 / r.R, 0)
      const i = Y.mul(v1.sub(v2)) // current from n1 -> n2
      ;(Ielts[r.name] ||= []).push(i)
    }
    for (const c of ckt.C) {
      const v1 = c.n1 === 0 ? Complex.from(0, 0) : x[c.n1 - 1]
      const v2 = c.n2 === 0 ? Complex.from(0, 0) : x[c.n2 - 1]
      const Y = Complex.from(0, twoPi * f * c.C)
      const i = Y.mul(v1.sub(v2))
      ;(Ielts[c.name] ||= []).push(i)
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? Complex.from(0, 0) : x[l.n1 - 1]
      const v2 = l.n2 === 0 ? Complex.from(0, 0) : x[l.n2 - 1]
      const Y = (function () {
        const d = Complex.from(0, twoPi * f * l.L)
        return d.abs() < EPS ? Complex.from(0, 0) : Complex.from(1, 0).div(d)
      })()
      const i = Y.mul(v1.sub(v2))
      ;(Ielts[l.name] ||= []).push(i)
    }
    for (const vs of ckt.V) {
      const i = x[vs.index] // branch current from n1->n2
      ;(Ielts[vs.name] ||= []).push(i)
    }
  }

  return { freqs, nodeVoltages: Vout, elementCurrents: Ielts }
}

function simulateTRAN(ckt) {
  if (!ckt.analyses.tran) return null
  const { dt, tstop } = ckt.analyses.tran
  const steps = Math.max(1, Math.ceil(tstop / Math.max(dt, EPS)))

  const nNodeVars = ckt.nodes.count() - 1
  const nVsrc = ckt.V.length
  const Nvar = nNodeVars + nVsrc

  const times = []
  const Vout = {}
  ckt.nodes.rev.forEach((name, id) => {
    if (id !== 0) Vout[name] = []
  })
  const Ielts = {} // element currents by name vs time

  // Pre-allocate matrices (real)
  function blankA() {
    const A = Array.from({ length: Nvar }, () => new Array(Nvar).fill(0))
    return A
  }
  function blankB() {
    return new Array(Nvar).fill(0)
  }

  // Time stepping (Backward Euler companion models)
  let t = 0
  for (let step = 0; step <= steps; step++, t = step * dt) {
    times.push(t)
    const A = blankA()
    const b = blankB()

    // Resistors
    for (const r of ckt.R) {
      const G = 1 / r.R
      stampY_real(A, ckt.nodes, r.n1, r.n2, G)
    }

    // Capacitors: Norton Gc = C/dt, Ieq = -Gc*vPrev (from n1->n2)
    for (const c of ckt.C) {
      const Gc = c.C / Math.max(dt, EPS)
      stampY_real(A, ckt.nodes, c.n1, c.n2, Gc)
      const Ieq = -Gc * c.vPrev
      stampI_real(b, ckt.nodes, c.n1, c.n2, Ieq)
    }

    // Inductors: Norton Gl = dt/L, Ieq = iPrev (from n1->n2)
    for (const l of ckt.L) {
      const Gl = Math.max(dt, EPS) / l.L // conductance
      stampY_real(A, ckt.nodes, l.n1, l.n2, Gl)
      stampI_real(b, ckt.nodes, l.n1, l.n2, l.iPrev)
    }

    // Voltage sources (independent): set branch equation and KCL couplings
    for (const vs of ckt.V) {
      // Instantaneous value
      const Vt = vs.waveform ? vs.waveform(t) : vs.dc || 0
      stampVsrc_real(A, b, ckt.nodes, vs, Vt, Nvar)
    }

    // Solve
    const x = solveReal(A, b)

    // Store node voltages
    for (let id = 1; id < ckt.nodes.count(); id++) {
      const idx = id - 1
      Vout[ckt.nodeNameById(id)].push(x[idx])
    }

    // Element currents (from n1 -> n2)
    for (const r of ckt.R) {
      const v1 = r.n1 === 0 ? 0 : x[r.n1 - 1]
      const v2 = r.n2 === 0 ? 0 : x[r.n2 - 1]
      const i = (v1 - v2) / r.R
      ;(Ielts[r.name] ||= []).push(i)
    }
    for (const c of ckt.C) {
      const v1 = c.n1 === 0 ? 0 : x[c.n1 - 1]
      const v2 = c.n2 === 0 ? 0 : x[c.n2 - 1]
      // Backward-Euler i = C*(v - vPrev)/dt
      const i = (c.C * (v1 - v2 - c.vPrev)) / Math.max(dt, EPS)
      ;(Ielts[c.name] ||= []).push(i)
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : x[l.n1 - 1]
      const v2 = l.n2 === 0 ? 0 : x[l.n2 - 1]
      const Gl = Math.max(dt, EPS) / l.L
      const i = Gl * (v1 - v2) + l.iPrev // Norton: i = Gl*v + iPrev
      ;(Ielts[l.name] ||= []).push(i)
    }
    for (const vs of ckt.V) {
      const i = x[vs.index] // branch current, orientation n1->n2
      ;(Ielts[vs.name] ||= []).push(i)
    }

    // Update dynamic states for next step
    for (const c of ckt.C) {
      const v1 = c.n1 === 0 ? 0 : x[c.n1 - 1]
      const v2 = c.n2 === 0 ? 0 : x[c.n2 - 1]
      c.vPrev = v1 - v2
    }
    for (const l of ckt.L) {
      const v1 = l.n1 === 0 ? 0 : x[l.n1 - 1]
      const v2 = l.n2 === 0 ? 0 : x[l.n2 - 1]
      const Gl = Math.max(dt, EPS) / l.L
      l.iPrev = Gl * (v1 - v2) + l.iPrev // update using computed i
    }
  }

  return { times, nodeVoltages: Vout, elementCurrents: Ielts }
}

// ------------------------ Facade ------------------------

function simulate(netlistText) {
  const ckt = parseNetlist(netlistText)
  const ac = simulateAC(ckt)
  const tran = simulateTRAN(ckt)
  return { circuit: ckt, ac, tran }
}

// Pretty format helpers for quick inspection
function formatAcResult(ac) {
  if (!ac) return "No AC analysis.\n"
  const nodes = Object.keys(ac.nodeVoltages)
  const lines = []
  lines.push(`f(Hz), ` + nodes.map((n) => `${n}:|V|,∠V(deg)`).join(", "))
  for (let k = 0; k < ac.freqs.length; k++) {
    const parts = [ac.freqs[k].toPrecision(6)]
    for (const n of nodes) {
      const z = ac.nodeVoltages[n][k]
      parts.push(`${z.abs().toPrecision(6)},${z.phaseDeg().toPrecision(6)}`)
    }
    lines.push(parts.join(", "))
  }
  return lines.join("\n")
}

function formatTranResult(tran) {
  if (!tran) return "No TRAN analysis.\n"
  const nodes = Object.keys(tran.nodeVoltages)
  const header = ["t(s)", ...nodes.map((n) => `${n}:V`)]
  const lines = [header.join(", ")]
  for (let k = 0; k < tran.times.length; k++) {
    const row = [tran.times[k].toPrecision(6)]
    for (const n of nodes) row.push((+tran.nodeVoltages[n][k]).toPrecision(6))
    lines.push(row.join(", "))
  }
  return lines.join("\n")
}

export {
  parseNetlist,
  simulate,
  simulateAC,
  simulateTRAN,
  formatAcResult,
  formatTranResult,
  // Expose classes if you want to extend
  Complex,
}

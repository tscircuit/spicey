import { parseNumberWithUnits } from "./parseNumberWithUnits"

interface SubcircuitDefinition {
  name: string
  ports: string[]
  defaultParams: Array<{ key: string; rawValue: string }>
  bodyLines: string[]
}

interface ExpansionContext {
  subcircuits: Map<string, SubcircuitDefinition>
  params: Map<string, number>
  models: Map<string, string>
}

const MAX_SUBCIRCUIT_DEPTH = 32
const SPICE_KEYWORDS = new Set([
  "dc",
  "ac",
  "tran",
  "pulse",
  "pwl",
  "sin",
  "sffm",
  "am",
  "params",
])

function stripInlineComments(line: string): string {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes) {
      if (ch === ";") {
        return line.slice(0, i).trimEnd()
      }
      if (ch === "/" && line[i + 1] === "/") {
        return line.slice(0, i).trimEnd()
      }
    }
  }
  return line
}

function tokenizeSpiceLine(line: string): string[] {
  const tokens: string[] = []
  let current = ""
  let parenDepth = 0
  let braceDepth = 0
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
      continue
    }
    if (!inQuotes) {
      if (ch === "(") parenDepth++
      else if (ch === ")" && parenDepth > 0) parenDepth--
      else if (ch === "{") braceDepth++
      else if (ch === "}" && braceDepth > 0) braceDepth--

      if (/\s/.test(ch) && parenDepth === 0 && braceDepth === 0) {
        if (current.length > 0) {
          tokens.push(current)
          current = ""
        }
        continue
      }
    }
    current += ch
  }

  if (current.length > 0) {
    tokens.push(current)
  }
  return tokens
}

function normalizeEqualsTokens(tokens: string[]): string[] {
  const result: string[] = []
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok === "=" && result.length > 0 && i + 1 < tokens.length) {
      const prev = result.pop()!
      result.push(`${prev}=${tokens[i + 1]!}`)
      i += 2
      continue
    }
    if (tok.endsWith("=") && tok.length > 1 && i + 1 < tokens.length) {
      result.push(`${tok}${tokens[i + 1]!}`)
      i += 2
      continue
    }
    if (tok.startsWith("=") && tok.length > 1 && result.length > 0) {
      const prev = result.pop()!
      result.push(`${prev}${tok}`)
      i++
      continue
    }
    result.push(tok)
    i++
  }
  return result
}

type ExprToken =
  | { type: "number"; value: number }
  | { type: "ident"; name: string }
  | { type: "op"; op: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" }

function tokenizeExpression(expr: string): ExprToken[] {
  const tokens: ExprToken[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" })
      i++
      continue
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" })
      i++
      continue
    }
    if (ch === ",") {
      tokens.push({ type: "comma" })
      i++
      continue
    }
    if (ch === "*" && expr[i + 1] === "*") {
      tokens.push({ type: "op", op: "^" })
      i += 2
      continue
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ type: "op", op: ch })
      i++
      continue
    }
    if (/\d|\./.test(ch)) {
      const slice = expr.slice(i)
      const numMatch = slice.match(
        /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[a-zA-Z]*/,
      )
      if (numMatch) {
        const rawLiteral = numMatch[0]
        const parsed = parseNumberWithUnits(rawLiteral)
        if (Number.isNaN(parsed)) {
          throw new Error(
            `Invalid numeric literal "${rawLiteral}" in "${expr}"`,
          )
        }
        tokens.push({ type: "number", value: parsed })
        i += rawLiteral.length
        continue
      }
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      const slice = expr.slice(i)
      const idMatch = slice.match(/^[a-zA-Z_$][a-zA-Z0-9_$.]*/)
      if (idMatch) {
        tokens.push({ type: "ident", name: idMatch[0] })
        i += idMatch[0].length
        continue
      }
    }
    throw new Error(
      `Unexpected character "${ch}" in SPICE expression "${expr}"`,
    )
  }
  return tokens
}

function applySpiceMathFunction(fnName: string, args: number[]): number {
  const lower = fnName.toLowerCase()
  const a0 = args[0] ?? 0
  const a1 = args[1] ?? 0
  switch (lower) {
    case "abs":
      return Math.abs(a0)
    case "sqrt":
      return Math.sqrt(a0)
    case "exp":
      return Math.exp(a0)
    case "ln":
    case "log":
      return Math.log(a0)
    case "log10":
      return Math.log10(a0)
    case "sin":
      return Math.sin(a0)
    case "cos":
      return Math.cos(a0)
    case "tan":
      return Math.tan(a0)
    case "min":
      return Math.min(...args)
    case "max":
      return Math.max(...args)
    case "pow":
      return a0 ** a1
    case "pwr":
      return Math.abs(a0) ** a1
    default:
      throw new Error(`Unsupported SPICE expression function "${fnName}"`)
  }
}

function evaluateSpiceExpression(
  rawExpr: string,
  params: ReadonlyMap<string, number>,
): number {
  const trimmed = rawExpr.trim().replace(/^\{/, "").replace(/\}$/, "").trim()
  if (!trimmed) {
    throw new Error("Empty SPICE parameter expression")
  }

  const tokens = tokenizeExpression(trimmed)
  let pos = 0

  const peek = () => tokens[pos]
  const consume = () => tokens[pos++]

  function parseAddSub(): number {
    let left = parseMulDiv()
    while (true) {
      const next = peek()
      if (next?.type === "op" && (next.op === "+" || next.op === "-")) {
        consume()
        const right = parseMulDiv()
        left = next.op === "+" ? left + right : left - right
      } else {
        break
      }
    }
    return left
  }

  function parseMulDiv(): number {
    let left = parseUnary()
    while (true) {
      const next = peek()
      if (next?.type === "op" && (next.op === "*" || next.op === "/")) {
        consume()
        const right = parseUnary()
        left = next.op === "*" ? left * right : left / right
      } else {
        break
      }
    }
    return left
  }

  function parseUnary(): number {
    const next = peek()
    if (next?.type === "op" && (next.op === "+" || next.op === "-")) {
      consume()
      const val = parseUnary()
      return next.op === "-" ? -val : val
    }
    return parsePower()
  }

  function parsePower(): number {
    const base = parsePrimary()
    const next = peek()
    if (next?.type === "op" && next.op === "^") {
      consume()
      const exp = parseUnary()
      return base ** exp
    }
    return base
  }

  function parsePrimary(): number {
    const tok = consume()
    if (!tok) {
      throw new Error(`Unexpected end of SPICE expression "${rawExpr}"`)
    }
    if (tok.type === "number") {
      return tok.value
    }
    if (tok.type === "lparen") {
      const val = parseAddSub()
      const close = consume()
      if (!close || close.type !== "rparen") {
        throw new Error(`Unclosed parenthesis in SPICE expression "${rawExpr}"`)
      }
      return val
    }
    if (tok.type === "ident") {
      if (peek()?.type === "lparen") {
        consume()
        const args: number[] = []
        if (peek()?.type !== "rparen") {
          args.push(parseAddSub())
          while (peek()?.type === "comma") {
            consume()
            args.push(parseAddSub())
          }
        }
        const close = consume()
        if (!close || close.type !== "rparen") {
          throw new Error(
            `Unclosed function call "${tok.name}" in "${rawExpr}"`,
          )
        }
        return applySpiceMathFunction(tok.name, args)
      }
      const key = tok.name.toLowerCase()
      const found = params.get(key)
      if (found === undefined) {
        throw new Error(
          `Unknown SPICE parameter "${tok.name}" in expression "${rawExpr}"`,
        )
      }
      return found
    }
    throw new Error(`Unexpected token in SPICE expression "${rawExpr}"`)
  }

  const result = parseAddSub()
  if (pos < tokens.length) {
    throw new Error(
      `Unexpected trailing tokens in SPICE expression "${rawExpr}"`,
    )
  }
  return result
}

function formatSpiceNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite SPICE parameter value: ${value}`)
  }
  return `${value}`
}

function substituteParamsInToken(
  token: string,
  params: ReadonlyMap<string, number>,
  allowBareIdentifier: boolean,
): string {
  if (params.size === 0 && !token.includes("{")) {
    return token
  }

  let out = token
  if (out.includes("{")) {
    out = out.replace(/\{([^}]+)\}/g, (_, inner: string) =>
      formatSpiceNumber(evaluateSpiceExpression(inner, params)),
    )
  }

  if (allowBareIdentifier && /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(out)) {
    const lower = out.toLowerCase()
    if (!SPICE_KEYWORDS.has(lower) && params.has(lower)) {
      return formatSpiceNumber(params.get(lower)!)
    }
  }

  if (out.includes("=") && !out.startsWith(".")) {
    const eqIdx = out.indexOf("=")
    const lhs = out.slice(0, eqIdx)
    const rhs = out.slice(eqIdx + 1)
    if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(rhs)) {
      const lower = rhs.toLowerCase()
      if (params.has(lower)) {
        return `${lhs}=${formatSpiceNumber(params.get(lower)!)}`
      }
    }
  }

  if (out.includes("(") && out.endsWith(")") && params.size > 0) {
    const openIdx = out.indexOf("(")
    const prefix = out.slice(0, openIdx + 1)
    const inner = out.slice(openIdx + 1, -1)
    const innerParts = inner.split(/(\s+|,)/)
    const replacedParts = innerParts.map((part) => {
      if (!part || /^\s+$/.test(part) || part === ",") return part
      if (part.includes("=")) {
        const eqIdx = part.indexOf("=")
        const k = part.slice(0, eqIdx)
        const v = part.slice(eqIdx + 1)
        const vLower = v.toLowerCase()
        if (params.has(vLower)) {
          return `${k}=${formatSpiceNumber(params.get(vLower)!)}`
        }
        return part
      }
      const pLower = part.toLowerCase()
      if (!SPICE_KEYWORDS.has(pLower) && params.has(pLower)) {
        return formatSpiceNumber(params.get(pLower)!)
      }
      return part
    })
    return `${prefix}${replacedParts.join("")})`
  }

  return out
}

function sanitizeSpiceIdentifier(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_")
}

function parseAssignmentPair(
  token: string,
): { key: string; rawValue: string } | null {
  const eqIdx = token.indexOf("=")
  if (eqIdx <= 0) return null
  const key = token.slice(0, eqIdx).trim()
  const rawValue = token.slice(eqIdx + 1).trim()
  if (!key || !rawValue) return null
  return { key, rawValue }
}

function parseSubcircuitHeader(headerLine: string): {
  name: string
  ports: string[]
  defaultParams: Array<{ key: string; rawValue: string }>
} {
  const tokens = normalizeEqualsTokens(tokenizeSpiceLine(headerLine))
  const name = tokens[1]
  if (!name) {
    throw new Error(`Malformed .subckt header: "${headerLine}"`)
  }

  const ports: string[] = []
  const defaultParams: Array<{ key: string; rawValue: string }> = []
  let inParamsSection = false

  for (let i = 2; i < tokens.length; i++) {
    const tok = tokens[i]!
    const lower = tok.toLowerCase()
    if (lower === "params:" || lower === "params") {
      inParamsSection = true
      continue
    }
    const pair = parseAssignmentPair(tok)
    if (pair) {
      inParamsSection = true
      defaultParams.push(pair)
      continue
    }
    if (inParamsSection) {
      throw new Error(
        `Unexpected token "${tok}" after PARAMS in .subckt "${name}"`,
      )
    }
    ports.push(tok)
  }

  return { name, ports, defaultParams }
}

function foldLogicalLines(text: string): {
  titleLine: string | null
  logicalLines: string[]
  hasEndDirective: boolean
} {
  const rawLines = text.split(/\r?\n/)
  let titleLine: string | null = null
  let seenFirstNonComment = false
  let hasEndDirective = false
  const logicalLines: string[] = []

  for (const raw of rawLines) {
    const trimmedStart = raw.trim()
    if (!trimmedStart) continue
    if (trimmedStart.startsWith("*")) continue

    const stripped = stripInlineComments(trimmedStart).trim()
    if (!stripped) continue

    if (/^\.end\b/i.test(stripped)) {
      hasEndDirective = true
      break
    }

    if (stripped.startsWith("+")) {
      const continuation = stripped.slice(1).trim()
      if (!continuation) continue
      if (logicalLines.length > 0) {
        logicalLines[logicalLines.length - 1] =
          `${logicalLines[logicalLines.length - 1]!} ${continuation}`
        continue
      }
    }

    if (!seenFirstNonComment) {
      seenFirstNonComment = true
      const firstTok = tokenizeSpiceLine(stripped)[0] ?? ""
      if (
        firstTok.length > 0 &&
        !/^[rclvgsmiqdx]\w*$/i.test(firstTok) &&
        !firstTok.startsWith(".")
      ) {
        titleLine = stripped
        continue
      }
    }

    logicalLines.push(stripped)
  }

  return { titleLine, logicalLines, hasEndDirective }
}

function mapInstanceNode(
  rawNode: string,
  portMap: ReadonlyMap<string, string>,
  instancePrefix: string,
): string {
  if (rawNode === "0") return "0"
  const mapped = portMap.get(rawNode.toLowerCase())
  if (mapped !== undefined) return mapped
  return `${instancePrefix}.${rawNode}`
}

function getNodeTokenIndices(typeChar: string): number[] {
  switch (typeChar) {
    case "r":
    case "c":
    case "l":
    case "v":
    case "i":
    case "d":
    case "f":
    case "h":
      return [1, 2]
    case "q":
    case "j":
    case "z":
      return [1, 2, 3]
    case "s":
    case "e":
    case "g":
    case "m":
      return [1, 2, 3, 4]
    default:
      return []
  }
}

function expandScopeLines(params: {
  lines: string[]
  parentContext: ExpansionContext
  instancePrefix: string
  portMap: ReadonlyMap<string, string>
  depth: number
  callStack: ReadonlySet<string>
}): string[] {
  const { lines, parentContext, instancePrefix, portMap, depth, callStack } =
    params
  if (depth > MAX_SUBCIRCUIT_DEPTH) {
    throw new Error(
      `Maximum SPICE subcircuit nesting depth (${MAX_SUBCIRCUIT_DEPTH}) exceeded`,
    )
  }

  const scopeSubcircuits = new Map(parentContext.subcircuits)
  const scopeParams = new Map(parentContext.params)
  const scopeModels = new Map(parentContext.models)
  const executableLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const tokens = normalizeEqualsTokens(tokenizeSpiceLine(line))
    if (tokens.length === 0) continue
    const firstLower = tokens[0]!.toLowerCase()

    if (firstLower === ".subckt") {
      const header = parseSubcircuitHeader(line)
      const bodyLines: string[] = []
      let nestedDepth = 1
      i++
      while (i < lines.length && nestedDepth > 0) {
        const innerLine = lines[i]!
        const innerFirst = (tokenizeSpiceLine(innerLine)[0] ?? "").toLowerCase()
        if (innerFirst === ".subckt") {
          nestedDepth++
          bodyLines.push(innerLine)
        } else if (innerFirst === ".ends") {
          nestedDepth--
          if (nestedDepth > 0) {
            bodyLines.push(innerLine)
          }
        } else {
          bodyLines.push(innerLine)
        }
        if (nestedDepth > 0) {
          i++
        }
      }
      if (nestedDepth !== 0) {
        throw new Error(`Missing .ends for .subckt "${header.name}"`)
      }
      scopeSubcircuits.set(header.name.toLowerCase(), {
        name: header.name,
        ports: header.ports,
        defaultParams: header.defaultParams,
        bodyLines,
      })
      continue
    }

    if (firstLower === ".param" || firstLower === ".params") {
      for (let t = 1; t < tokens.length; t++) {
        const tok = tokens[t]!
        if (tok.toLowerCase() === "params:") continue
        const pair = parseAssignmentPair(tok)
        if (!pair) continue
        scopeParams.set(
          pair.key.toLowerCase(),
          evaluateSpiceExpression(pair.rawValue, scopeParams),
        )
      }
      continue
    }

    if (firstLower === ".model" && instancePrefix.length > 0 && tokens[1]) {
      const origModelName = tokens[1]
      const scopedModelName = `${sanitizeSpiceIdentifier(instancePrefix)}_${origModelName}`
      scopeModels.set(origModelName.toLowerCase(), scopedModelName)
    }

    executableLines.push(line)
  }

  const emittedLines: string[] = []

  for (const line of executableLines) {
    const tokens = normalizeEqualsTokens(tokenizeSpiceLine(line))
    if (tokens.length === 0) continue
    const first = tokens[0]!
    const firstLower = first.toLowerCase()

    if (firstLower === ".model") {
      const rewritten = [...tokens]
      if (instancePrefix.length > 0 && rewritten[1]) {
        const mappedModel = scopeModels.get(rewritten[1].toLowerCase())
        if (mappedModel) {
          rewritten[1] = mappedModel
        }
      }
      for (let t = 2; t < rewritten.length; t++) {
        rewritten[t] = substituteParamsInToken(
          rewritten[t]!,
          scopeParams,
          false,
        )
      }
      emittedLines.push(rewritten.join(" "))
      continue
    }

    if (firstLower.startsWith(".")) {
      const rewritten = tokens.map((tok, idx) =>
        idx === 0 ? tok : substituteParamsInToken(tok, scopeParams, false),
      )
      emittedLines.push(rewritten.join(" "))
      continue
    }

    const typeChar = firstLower.charAt(0)
    if (typeChar === "x") {
      const overrides: Array<{ key: string; rawValue: string }> = []
      let cursor = tokens.length - 1
      while (cursor >= 2) {
        const pair = parseAssignmentPair(tokens[cursor]!)
        if (!pair) break
        overrides.unshift(pair)
        cursor--
      }
      if (cursor >= 2) {
        const maybeParamsKw = tokens[cursor]!.toLowerCase()
        if (maybeParamsKw === "params:" || maybeParamsKw === "params") {
          cursor--
        }
      }
      if (cursor < 1) {
        throw new Error(`Subcircuit call missing subcircuit name: "${line}"`)
      }

      const subcktName = tokens[cursor]!
      const subcktKey = subcktName.toLowerCase()
      const subcktDef = scopeSubcircuits.get(subcktKey)
      if (!subcktDef) {
        throw new Error(
          `Unknown .subckt "${subcktName}" referenced by "${first}"`,
        )
      }
      if (callStack.has(subcktKey)) {
        throw new Error(
          `Recursive .subckt instantiation detected for "${subcktDef.name}"`,
        )
      }

      const rawActualNodes = tokens.slice(1, cursor)
      if (rawActualNodes.length !== subcktDef.ports.length) {
        throw new Error(
          `Subcircuit "${subcktDef.name}" expects ${subcktDef.ports.length} port(s), but "${first}" supplied ${rawActualNodes.length}`,
        )
      }

      const childPortMap = new Map<string, string>()
      for (let p = 0; p < subcktDef.ports.length; p++) {
        const formalPort = subcktDef.ports[p]!.toLowerCase()
        const actualNode =
          instancePrefix.length > 0
            ? mapInstanceNode(rawActualNodes[p]!, portMap, instancePrefix)
            : rawActualNodes[p]!
        childPortMap.set(formalPort, actualNode)
      }

      const childParams = new Map(scopeParams)
      for (const defParam of subcktDef.defaultParams) {
        childParams.set(
          defParam.key.toLowerCase(),
          evaluateSpiceExpression(defParam.rawValue, childParams),
        )
      }
      for (const ov of overrides) {
        childParams.set(
          ov.key.toLowerCase(),
          evaluateSpiceExpression(ov.rawValue, scopeParams),
        )
      }

      const childInstPrefix =
        instancePrefix.length > 0 ? `${instancePrefix}.${first}` : first
      const nextCallStack = new Set(callStack)
      nextCallStack.add(subcktKey)

      const childExpanded = expandScopeLines({
        lines: subcktDef.bodyLines,
        parentContext: {
          subcircuits: scopeSubcircuits,
          params: childParams,
          models: scopeModels,
        },
        instancePrefix: childInstPrefix,
        portMap: childPortMap,
        depth: depth + 1,
        callStack: nextCallStack,
      })
      emittedLines.push(...childExpanded)
      continue
    }

    const rewritten = [...tokens]
    const nodeIndices = new Set(getNodeTokenIndices(typeChar))

    if (instancePrefix.length > 0) {
      const rawElementSuffix = first.slice(1) || "0"
      rewritten[0] = `${first.charAt(0)}_${sanitizeSpiceIdentifier(instancePrefix)}_${sanitizeSpiceIdentifier(rawElementSuffix)}`

      for (const nodeIdx of nodeIndices) {
        if (nodeIdx < rewritten.length) {
          rewritten[nodeIdx] = mapInstanceNode(
            rewritten[nodeIdx]!,
            portMap,
            instancePrefix,
          )
        }
      }
    }

    const modelTokenIdx =
      typeChar === "d" ? 3 : typeChar === "s" ? 5 : undefined
    if (
      modelTokenIdx !== undefined &&
      modelTokenIdx < rewritten.length &&
      scopeModels.size > 0
    ) {
      const mappedModel = scopeModels.get(
        rewritten[modelTokenIdx]!.toLowerCase(),
      )
      if (mappedModel) {
        rewritten[modelTokenIdx] = mappedModel
      }
    }

    for (let t = 1; t < rewritten.length; t++) {
      if (nodeIndices.has(t) || t === modelTokenIdx) continue
      rewritten[t] = substituteParamsInToken(rewritten[t]!, scopeParams, true)
    }

    emittedLines.push(rewritten.join(" "))
  }

  return emittedLines
}

export function expandSubcircuits(text: string): string {
  if (
    !/\.subckt\b/i.test(text) &&
    !/\.param/i.test(text) &&
    !text.includes("{") &&
    !/(?:^|\n)\s*\+/.test(text) &&
    !/(?:^|\n)\s*x\S*\s/i.test(text)
  ) {
    return text
  }

  const { titleLine, logicalLines, hasEndDirective } = foldLogicalLines(text)
  const expanded = expandScopeLines({
    lines: logicalLines,
    parentContext: {
      subcircuits: new Map(),
      params: new Map(),
      models: new Map(),
    },
    instancePrefix: "",
    portMap: new Map(),
    depth: 0,
    callStack: new Set(),
  })

  const output: string[] = []
  if (titleLine) {
    output.push(titleLine)
  }
  output.push(...expanded)
  if (hasEndDirective) {
    output.push(".end")
  }
  return output.join("\n")
}

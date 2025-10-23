import "bun-match-svg"

// Polyfill WebAssembly.instantiateStreaming for environments (like Bun) that do not
// provide it. eecircuit-engine will attempt to use instantiateStreaming first and
// fall back to ArrayBuffer instantiation otherwise. However, its fallback path relies
// on synchronous XHR which is not available in Bun. Providing the streaming helper
// keeps the engine on the fast path and allows the ngspice WASM module to load.
if (typeof WebAssembly.instantiateStreaming !== "function") {
  const instantiateStreaming = async (
    source: Response | Promise<Response>,
    importObject?: unknown,
  ) => {
    const response = source instanceof Response ? source : await source
    const bytes = await response.arrayBuffer()
    return WebAssembly.instantiate(bytes, importObject as any)
  }

  // @ts-expect-error augmenting global WebAssembly helper
  WebAssembly.instantiateStreaming = instantiateStreaming
}

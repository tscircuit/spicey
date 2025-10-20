class NodeIndex {
  private map: Map<string, number>
  rev: string[]

  constructor() {
    this.map = new Map([["0", 0]])
    this.rev = ["0"]
  }

  getOrCreate(name: string) {
    const origName = String(name)
    const key = origName.toUpperCase()
    if (this.map.has(key)) return this.map.get(key) as number
    const idx = this.rev.length
    this.map.set(key, idx)
    this.rev.push(origName)
    return idx
  }

  get(name: string) {
    return this.map.get(String(name).toUpperCase())
  }

  count() {
    return this.rev.length
  }

  matrixIndexOfNode(nodeId: number) {
    if (nodeId === 0) return -1
    return nodeId - 1
  }
}

type CircuitNodeIndex = NodeIndex

export { NodeIndex }
export type { CircuitNodeIndex }

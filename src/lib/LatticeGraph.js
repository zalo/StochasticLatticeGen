/**
 * An undirected graph of straight struts with de-duplicated vertices.
 *
 * Positions are stored flat (`x0, y0, z0, x1, y1, z1, ...`) and edges as flat
 * index pairs (`a0, b0, a1, b1, ...`). Vertices closer than `tolerance` are
 * merged into one, so struts that meet at a (numerically slightly different)
 * point share a vertex and the resulting graph is connected.
 */
export class LatticeGraph {
  /**
   * @param {object} [options]
   * @param {number} [options.tolerance=1e-6] Vertices closer than this snap together.
   */
  constructor({ tolerance = 1e-6 } = {}) {
    this.tolerance = tolerance;
    /** @type {number[]} Flat xyz vertex positions. */
    this.positions = [];
    /** @type {number[]} Flat vertex index pairs. */
    this.edges = [];
    this._vertexKeys = new Map();
    this._edgeKeys = new Set();
  }

  get vertexCount() { return this.positions.length / 3; }
  get edgeCount() { return this.edges.length / 2; }

  /** Adds a vertex (or returns the index of an existing one within tolerance). */
  addVertex(x, y, z) {
    const q = 1 / this.tolerance;
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let index = this._vertexKeys.get(key);
    if (index === undefined) {
      index = this.vertexCount;
      this._vertexKeys.set(key, index);
      this.positions.push(x, y, z);
    }
    return index;
  }

  /** Adds an edge between two vertex indices; ignores duplicates and degenerate edges. */
  addEdge(a, b) {
    if (a === b) { return false; }
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (this._edgeKeys.has(key)) { return false; }
    this._edgeKeys.add(key);
    this.edges.push(a, b);
    return true;
  }

  /** Adds a strut between two points given as coordinates. */
  addSegment(ax, ay, az, bx, by, bz) {
    return this.addEdge(this.addVertex(ax, ay, az), this.addVertex(bx, by, bz));
  }

  /** Writes the position of vertex `index` into `target` (an array-like with 3 slots). */
  getVertex(index, target = [0, 0, 0]) {
    target[0] = this.positions[index * 3];
    target[1] = this.positions[index * 3 + 1];
    target[2] = this.positions[index * 3 + 2];
    return target;
  }

  /** Labels every vertex with a connected-component id. */
  connectedComponents() {
    const n = this.vertexCount;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) { parent[i] = i; }
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = find(this.edges[e]), b = find(this.edges[e + 1]);
      if (a !== b) { parent[a] = b; }
    }
    const labels = new Int32Array(n);
    const sizes = [];
    const rootToLabel = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      let label = rootToLabel.get(root);
      if (label === undefined) { label = sizes.length; rootToLabel.set(root, label); sizes.push(0); }
      labels[i] = label;
      sizes[label]++;
    }
    return { labels, sizes };
  }

  /**
   * Returns a copy containing only the largest connected component
   * (or every component with at least `minVertices` vertices).
   */
  pruneIslands({ minVertices = 0 } = {}) {
    const { labels, sizes } = this.connectedComponents();
    const largest = sizes.indexOf(Math.max(...sizes, 0));
    const keep = (label) => label === largest || (minVertices > 0 && sizes[label] >= minVertices);
    const pruned = new LatticeGraph({ tolerance: this.tolerance });
    const a = [0, 0, 0], b = [0, 0, 0];
    for (let e = 0; e < this.edges.length; e += 2) {
      const ia = this.edges[e], ib = this.edges[e + 1];
      if (!keep(labels[ia])) { continue; }
      this.getVertex(ia, a); this.getVertex(ib, b);
      pruned.addSegment(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return pruned;
  }

  /** Returns the graph as typed arrays suitable for `postMessage` transfer. */
  toArrays() {
    return { positions: Float32Array.from(this.positions), edges: Uint32Array.from(this.edges) };
  }

  /** Rebuilds a graph from `toArrays()` output (re-welding vertices with `tolerance`). */
  static fromArrays({ positions, edges }, options = {}) {
    const graph = new LatticeGraph(options);
    for (let e = 0; e < edges.length; e += 2) {
      const a = edges[e] * 3, b = edges[e + 1] * 3;
      graph.addSegment(positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2]);
    }
    return graph;
  }
}

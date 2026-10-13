import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { Voro3D } from 'voro3d';

/**
 * @typedef {object} VoronoiCell One cell as returned by voro3d (world coordinates).
 * @property {number} particleID
 * @property {number[]} vertices Flat xyz cell vertex positions.
 * @property {number[][]} faces Vertex-index loops, one per face.
 * @property {number[]} neighbors Neighbouring particle id per face (negative for container walls).
 */

/**
 * Computes the Voronoi cells of a point set clipped to a bounding box.
 * A fresh voro++ container is created for every call so repeated calls are independent.
 * @param {ArrayLike<number>} points Flat xyz seed positions.
 * @param {import('three').Box3} bounds Container box; seeds outside it are dropped by voro++.
 * @param {object} [options]
 * @param {(stage: string, fraction: number) => void} [options.onProgress]
 * @returns {Promise<VoronoiCell[]>}
 */
export async function computeVoronoiCells(points, bounds, { onProgress } = {}) {
  // voro3d treats an exact 0 bound as "unset", so nudge those by a hair.
  const nudge = (v) => (v === 0 ? 1e-9 : v);
  const count = points.length / 3;
  // voro++ performs best with ~5 particles per computational block.
  const blocks = Math.max(1, Math.round(Math.cbrt(count / 5)));
  onProgress?.('Computing Voronoi cells', -1);
  const container = await Voro3D.create(
    nudge(bounds.min.x), nudge(bounds.max.x),
    nudge(bounds.min.y), nudge(bounds.max.y),
    nudge(bounds.min.z), nudge(bounds.max.z),
    blocks, blocks, blocks);
  const cells = container.computeCells(Array.from(points), true);
  onProgress?.('Computing Voronoi cells', 1);
  return cells;
}

/**
 * Adds every unique Voronoi cell edge to `graph` as a strut.
 * @param {VoronoiCell[]} cells
 * @param {import('./LatticeGraph.js').LatticeGraph} graph
 */
export function addVoronoiEdges(cells, graph, { onProgress } = {}) {
  for (let c = 0; c < cells.length; c++) {
    const { vertices, faces } = cells[c];
    for (const face of faces) {
      for (let k = 0; k < face.length; k++) {
        const a = face[k] * 3, b = face[(k + 1) % face.length] * 3;
        graph.addSegment(vertices[a], vertices[a + 1], vertices[a + 2], vertices[b], vertices[b + 1], vertices[b + 2]);
      }
    }
    if (c % 500 === 0) { onProgress?.('Collecting cell edges', c / cells.length); }
  }
  onProgress?.('Collecting cell edges', 1);
  return graph;
}

/**
 * Builds a triangle mesh of the interior Voronoi cell faces (each shared face once),
 * used to intersect the cell boundaries with a surface.
 * @param {VoronoiCell[]} cells
 * @returns {BufferGeometry}
 */
export function voronoiFaceGeometry(cells, { onProgress } = {}) {
  const positions = [];
  const indices = [];
  const seen = new Set();
  for (let c = 0; c < cells.length; c++) {
    const { particleID, vertices, faces, neighbors } = cells[c];
    for (let f = 0; f < faces.length; f++) {
      const neighbor = neighbors[f];
      if (neighbor < 0) { continue; } // container wall, not a cell/cell boundary
      const key = particleID < neighbor ? `${particleID}:${neighbor}` : `${neighbor}:${particleID}`;
      if (seen.has(key)) { continue; }
      seen.add(key);
      const face = faces[f];
      const base = positions.length / 3;
      for (const v of face) { positions.push(vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]); }
      for (let k = 1; k < face.length - 1; k++) { indices.push(base, base + k, base + k + 1); }
    }
    if (c % 500 === 0) { onProgress?.('Triangulating cell faces', c / cells.length); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(indices), 1));
  onProgress?.('Triangulating cell faces', 1);
  return geometry;
}

/** Convenience: the seed point of every cell as a flat array (voro++ may drop seeds outside the box). */
export function cellSeeds(cells) {
  const seeds = new Float32Array(cells.length * 3);
  const v = new Vector3();
  cells.forEach((cell, i) => { v.set(cell.x, cell.y, cell.z).toArray(seeds, i * 3); });
  return seeds;
}

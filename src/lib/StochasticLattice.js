import { Box3, Vector3 } from 'three';
import { LatticeGraph } from './LatticeGraph.js';
import { buildBVH, expandedBounds, offsetGeometry, prepareGeometry } from './MeshUtils.js';
import { createRandom, sampleSurfacePoints, sampleVolumePoints } from './Sampling.js';
import { addVoronoiEdges, computeVoronoiCells, voronoiFaceGeometry } from './Voronoi.js';
import { addSurfaceContours, trimGraphToMesh } from './Clipping.js';
import { sweepGraph } from './Sweep.js';

/** Where seed points are placed. */
export const SAMPLE_MODES = Object.freeze({
  /** Uniformly over the (offset) surface. */
  SURFACE: 'surface',
  /** Uniformly through the enclosed volume. */
  VOLUME: 'volume',
});

/** How the Voronoi lattice is clipped against the (offset) mesh. */
export const CLIP_MODES = Object.freeze({
  /** Keep every cell edge inside the bounding box; ignore the mesh. */
  UNCONSTRAINED: 'unconstrained',
  /** Cut struts where they cross the surface and discard the outside parts. */
  TRIMMED: 'trimmed',
  /** Trimmed struts plus the curves where cell walls meet the surface (a closed, surface-conforming lattice). */
  CONFORMING: 'conforming',
  /** Only the curves where cell walls meet the surface (a Voronoi pattern on the surface). */
  SURFACE: 'surface',
});

/**
 * Generates stochastic (Voronoi) lattices bounded by a mesh.
 *
 * ```js
 * const lattice = new StochasticLattice(geometry, { offset: -2 });
 * const seeds   = lattice.samplePoints({ mode: 'volume', count: 1000, seed: 7 });
 * const graph   = await lattice.computeLattice(seeds, { clipping: 'conforming' });
 * const solid   = await lattice.sweep(graph, { radius: 0.5, profile: 'icosphere' });
 * ```
 *
 * Every method accepts an `onProgress(stage, fraction)` callback; `fraction`
 * is `-1` while a stage's progress is unknown.
 */
export class StochasticLattice {
  /**
   * @param {import('three').BufferGeometry|import('./MeshUtils.js').MeshArrays} mesh A closed triangle mesh.
   * @param {object} [options]
   * @param {number} [options.offset=0] Inset (< 0) or outset (> 0) distance of the lattice boundary from the mesh.
   */
  constructor(mesh, { offset = 0 } = {}) {
    /** The welded, smoothly-shaded input mesh. */
    this.baseGeometry = prepareGeometry(mesh);
    /** Bounding box of the input mesh. */
    this.baseBounds = this.baseGeometry.boundingBox.clone();
    /** Length of the input's bounding-box diagonal; a convenient size reference. */
    this.scale = this.baseBounds.getSize(new Vector3()).length() || 1;
    /** Distance below which lattice vertices are merged. */
    this.tolerance = this.scale * 1e-6;
    this.baseBVH = buildBVH(this.baseGeometry);
    this._offset = null;
    this.clipGeometry = null;
    this.clipBVH = null;
    this.setOffset(offset);
  }

  /** The current inset/outset distance. */
  get offset() { return this._offset; }

  /** Rebuilds the clipping surface at a new inset (< 0) or outset (> 0) distance. */
  setOffset(offset) {
    if (offset === this._offset) { return; }
    this._offset = offset;
    if (this.clipGeometry && this.clipGeometry !== this.baseGeometry) { this.clipGeometry.dispose(); }
    this.clipGeometry = offset === 0 ? this.baseGeometry : offsetGeometry(this.baseGeometry, offset, { bvh: this.baseBVH });
    this.clipBVH = offset === 0 ? this.baseBVH : buildBVH(this.clipGeometry);
    /** Bounding box of the clipping surface. */
    this.bounds = this.clipGeometry.boundingBox.clone();
  }

  /**
   * Samples Voronoi seed points on or inside the clipping surface.
   * @param {object} [options]
   * @param {'surface'|'volume'} [options.mode='surface']
   * @param {number} [options.count=500]
   * @param {number} [options.seed] Seed for a deterministic point set; omit for `Math.random`.
   * @param {(stage: string, fraction: number) => void} [options.onProgress]
   * @returns {Float32Array} Flat xyz positions.
   */
  samplePoints({ mode = SAMPLE_MODES.SURFACE, count = 500, seed, onProgress } = {}) {
    const random = seed === undefined ? Math.random : createRandom(seed);
    if (mode === SAMPLE_MODES.VOLUME) {
      return sampleVolumePoints(this.clipGeometry, this.clipBVH, count, { random, onProgress });
    }
    return sampleSurfacePoints(this.clipGeometry, count, { random, onProgress });
  }

  /**
   * Builds the Voronoi lattice of a seed point set and clips it to the surface.
   * @param {ArrayLike<number>} points Flat xyz seed positions.
   * @param {object} [options]
   * @param {'unconstrained'|'trimmed'|'conforming'|'surface'} [options.clipping='conforming']
   * @param {boolean} [options.pruneIslands=false] Drop struts not connected to the largest component.
   * @param {(stage: string, fraction: number) => void} [options.onProgress]
   * @returns {Promise<LatticeGraph>}
   */
  async computeLattice(points, { clipping = CLIP_MODES.CONFORMING, pruneIslands = false, onProgress } = {}) {
    const cells = await computeVoronoiCells(points, expandedBounds(this.bounds, 0.02), { onProgress });
    let graph = new LatticeGraph({ tolerance: this.tolerance });

    if (clipping !== CLIP_MODES.SURFACE) {
      addVoronoiEdges(cells, graph, { onProgress });
    }
    if (clipping === CLIP_MODES.TRIMMED || clipping === CLIP_MODES.CONFORMING) {
      graph = trimGraphToMesh(graph, this.clipBVH, { onProgress });
    }
    if (clipping === CLIP_MODES.CONFORMING || clipping === CLIP_MODES.SURFACE) {
      const faces = voronoiFaceGeometry(cells, { onProgress });
      addSurfaceContours(graph, this.clipBVH, faces, { onProgress });
      faces.dispose();
    }
    if (pruneIslands) {
      onProgress?.('Pruning disconnected struts', -1);
      graph = graph.pruneIslands();
    }
    onProgress?.('Lattice complete', 1);
    return graph;
  }

  /**
   * Converts a lattice graph into a watertight strut mesh. See {@link sweepGraph}.
   * @param {LatticeGraph|{ positions: ArrayLike<number>, edges: ArrayLike<number> }} graph
   * @param {Parameters<typeof sweepGraph>[1]} [options]
   */
  sweep(graph, options) {
    return sweepGraph(graph, options);
  }

  /** Frees GPU/BVH resources held by the geometries. */
  dispose() {
    if (this.clipGeometry !== this.baseGeometry) { this.clipGeometry?.dispose(); }
    this.baseGeometry.dispose();
    this.clipGeometry = null;
    this.clipBVH = null;
    this.baseBVH = null;
  }
}

// Web worker that owns a StochasticLattice instance and exposes it over a tiny RPC protocol.
// Messages in:  { id, method, args }
// Messages out: { ready: true } | { id, progress: { stage, fraction } } | { id, result } | { id, error }
import { StochasticLattice, sweepGraph, toMeshArrays } from '../index.js';

/** @type {StochasticLattice|null} */
let lattice = null;

/** Marks a result whose ArrayBuffers should be transferred rather than copied. */
const transferable = (result, buffers) => ({ __transferable: true, result, buffers });

function describeLattice() {
  const base = toMeshArrays(lattice.baseGeometry);
  const clip = lattice.offset === 0 ? null : toMeshArrays(lattice.clipGeometry);
  const { min, max } = lattice.bounds;
  return {
    scale: lattice.scale,
    bounds: { min: min.toArray(), max: max.toArray() },
    baseMesh: base,
    clipMesh: clip,
  };
}

const methods = {
  setMesh({ mesh, offset }) {
    lattice?.dispose();
    lattice = new StochasticLattice(mesh, { offset });
    return describeLattice();
  },
  setOffset({ offset }) {
    lattice.setOffset(offset);
    return describeLattice();
  },
  samplePoints(options, onProgress) {
    const points = lattice.samplePoints({ ...options, onProgress });
    return transferable(points, [points.buffer]);
  },
  async computeLattice({ points, ...options }, onProgress) {
    const graph = await lattice.computeLattice(points, { ...options, onProgress });
    const arrays = graph.toArrays();
    return transferable(arrays, [arrays.positions.buffer, arrays.edges.buffer]);
  },
  async sweep({ graph, ...options }, onProgress) {
    const mesh = await sweepGraph(graph, { ...options, onProgress });
    return transferable(mesh, [mesh.positions.buffer, mesh.indices.buffer]);
  },
};

self.onmessage = async ({ data: { id, method, args } }) => {
  const onProgress = (stage, fraction) => self.postMessage({ id, progress: { stage, fraction } });
  try {
    if (!(method in methods)) { throw new Error(`Unknown worker method "${method}"`); }
    if (!lattice && method !== 'setMesh') { throw new Error('No mesh loaded'); }
    const output = await methods[method](args, onProgress);
    if (output?.__transferable) {
      self.postMessage({ id, result: output.result }, output.buffers);
    } else {
      self.postMessage({ id, result: output });
    }
  } catch (error) {
    console.error(error);
    self.postMessage({ id, error: error?.message ?? String(error) });
  }
};

self.postMessage({ ready: true });

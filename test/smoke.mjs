// Runs the whole library pipeline in Node against the bundled armadillo mesh.
// Usage: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StochasticLattice, LatticeGraph, graphToPLY, meshToOBJ, meshToSTL, pointsToPLY } from '../src/index.js';

function loadOBJ(path) {
  const positions = [], indices = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      positions.push(+x, +y, +z);
    } else if (line.startsWith('f ')) {
      const face = line.trim().split(/\s+/).slice(1).map((token) => parseInt(token, 10) - 1);
      for (let i = 1; i < face.length - 1; i++) { indices.push(face[0], face[i], face[i + 1]); }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

const time = async (label, fn) => {
  const start = performance.now();
  const result = await fn();
  console.log(`${label.padEnd(48)} ${(performance.now() - start).toFixed(0).padStart(6)} ms`);
  return result;
};

const mesh = loadOBJ(fileURLToPath(new URL('../assets/armadillo.obj', import.meta.url)));
const lattice = await time('prepare mesh', () => new StochasticLattice(mesh));
assert.ok(lattice.scale > 0);

for (const offset of [0, -0.02 * lattice.scale, 0.02 * lattice.scale]) {
  lattice.setOffset(offset);
  for (const mode of ['surface', 'volume']) {
    const points = lattice.samplePoints({ mode, count: 300, seed: 42 });
    assert.equal(points.length, 300 * 3, 'all requested points sampled');
    const again = lattice.samplePoints({ mode, count: 300, seed: 42 });
    assert.deepEqual(points, again, 'seeded sampling is deterministic');
    for (const clipping of ['unconstrained', 'trimmed', 'conforming', 'surface']) {
      const graph = await time(`offset ${offset.toFixed(1)} ${mode} ${clipping}`,
        () => lattice.computeLattice(points, { clipping }));
      assert.ok(graph.edgeCount > 0, 'lattice has struts');
      assert.ok(graph.vertexCount > 0);
    }
  }
}

lattice.setOffset(0);
const points = lattice.samplePoints({ mode: 'surface', count: 200, seed: 7 });
const trimmed = await lattice.computeLattice(points, { clipping: 'trimmed' });
const pruned = await lattice.computeLattice(points, { clipping: 'trimmed', pruneIslands: true });
assert.equal(pruned.connectedComponents().sizes.length, 1, 'pruning leaves one component');
assert.ok(pruned.edgeCount <= trimmed.edgeCount);

const roundTrip = LatticeGraph.fromArrays(trimmed.toArrays(), { tolerance: lattice.tolerance });
assert.equal(roundTrip.edgeCount, trimmed.edgeCount, 'graph survives an array round trip');

const solid = await time(`sweep ${pruned.edgeCount} struts`, () =>
  lattice.sweep(pruned, { radius: lattice.scale * 0.003, profile: 'icosahedron' }));
assert.ok(solid.indices.length > 0 && solid.indices.length % 3 === 0, 'sweep produced triangles');

const stl = meshToSTL(solid);
assert.equal(stl.byteLength, 84 + (solid.indices.length / 3) * 50, 'binary STL size');
assert.ok(meshToOBJ(solid).startsWith('o lattice\nv '));
assert.ok(graphToPLY(pruned.toArrays()).includes(`element edge ${pruned.edgeCount}`));
assert.ok(pointsToPLY(points).includes('element vertex 200'));
console.log('All smoke tests passed.');

// The thickness clamp must keep an inset surface from inverting: every inset vertex
// stays inside the original mesh, and the inset bounding box shrinks.
{
  const { isInside } = await import('../src/lib/MeshUtils.js');
  const { Ray, Vector3 } = await import('three');
  const inset = -0.03 * lattice.scale; // deeper than the armadillo's fingers are thick
  lattice.setOffset(inset);
  const position = lattice.clipGeometry.getAttribute('position');
  const ray = new Ray(), point = new Vector3();
  let outside = 0;
  for (let i = 0; i < position.count; i += 25) {
    point.fromBufferAttribute(position, i);
    if (!isInside(lattice.baseBVH, point, ray)) { outside++; }
  }
  assert.ok(outside / Math.ceil(position.count / 25) < 0.01, `inset vertices stay inside (${outside} escaped)`);
  assert.ok(lattice.bounds.min.y > lattice.baseBounds.min.y, 'inset bounds shrink');
  lattice.setOffset(0);
  console.log('Inset clamp test passed.');
}

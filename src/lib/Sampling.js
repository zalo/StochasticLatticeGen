import { Mesh, Ray, Vector3 } from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { isInside } from './MeshUtils.js';

/** A small, fast seeded PRNG (mulberry32) returning numbers in [0, 1). */
export function createRandom(seed = 1) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Samples points uniformly (by area) over a mesh surface.
 * @param {import('three').BufferGeometry} geometry
 * @param {number} count
 * @param {object} [options]
 * @param {() => number} [options.random] Random source in [0, 1); defaults to `Math.random`.
 * @param {(stage: string, fraction: number) => void} [options.onProgress]
 * @returns {Float32Array} Flat xyz positions.
 */
export function sampleSurfacePoints(geometry, count, { random = Math.random, onProgress } = {}) {
  const sampler = new MeshSurfaceSampler(new Mesh(geometry)).setRandomGenerator(random).build();
  const points = new Float32Array(count * 3);
  const point = new Vector3();
  for (let i = 0; i < count; i++) {
    sampler.sample(point);
    points[i * 3] = point.x;
    points[i * 3 + 1] = point.y;
    points[i * 3 + 2] = point.z;
    if (i % 1000 === 0) { onProgress?.('Sampling surface points', i / count); }
  }
  onProgress?.('Sampling surface points', 1);
  return points;
}

/**
 * Samples points uniformly inside a closed mesh by rejection sampling its bounding box.
 * @param {import('three').BufferGeometry} geometry Must have a computed bounding box.
 * @param {import('three-mesh-bvh').MeshBVH} bvh BVH of the same geometry.
 * @param {number} count
 * @param {object} [options]
 * @param {() => number} [options.random]
 * @param {number} [options.maxAttempts] Safety cap on rejected samples.
 * @param {(stage: string, fraction: number) => void} [options.onProgress]
 * @returns {Float32Array} Flat xyz positions (may be shorter than requested if the cap is hit).
 */
export function sampleVolumePoints(geometry, bvh, count, { random = Math.random, maxAttempts = count * 2000, onProgress } = {}) {
  if (!geometry.boundingBox) { geometry.computeBoundingBox(); }
  const { min, max } = geometry.boundingBox;
  const size = max.clone().sub(min);
  const points = new Float32Array(count * 3);
  const point = new Vector3();
  const ray = new Ray();
  let found = 0;
  for (let attempt = 0; found < count && attempt < maxAttempts; attempt++) {
    point.set(min.x + random() * size.x, min.y + random() * size.y, min.z + random() * size.z);
    if (!isInside(bvh, point, ray)) { continue; }
    points[found * 3] = point.x;
    points[found * 3 + 1] = point.y;
    points[found * 3 + 2] = point.z;
    found++;
    if (found % 500 === 0) { onProgress?.('Sampling volume points', found / count); }
  }
  onProgress?.('Sampling volume points', 1);
  return found === count ? points : points.slice(0, found * 3);
}

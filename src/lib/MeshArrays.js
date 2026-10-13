import { BufferAttribute, BufferGeometry } from 'three';

/**
 * A plain, structured-clone friendly triangle mesh.
 * @typedef {object} MeshArrays
 * @property {Float32Array} positions Flat xyz vertex positions.
 * @property {Uint32Array} indices Flat triangle vertex indices.
 * @property {Float32Array} [normals] Optional flat xyz vertex normals.
 */

/** Converts a `MeshArrays` object to a `BufferGeometry` (a `BufferGeometry` input is returned as is). */
export function toGeometry(input) {
  if (input.isBufferGeometry) { return input; }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(input.positions), 3));
  if (input.normals) { geometry.setAttribute('normal', new BufferAttribute(Float32Array.from(input.normals), 3)); }
  if (input.indices) { geometry.setIndex(new BufferAttribute(Uint32Array.from(input.indices), 1)); }
  return geometry;
}

/** Copies a geometry's positions, indices (and normals, if present) into transferable typed arrays. */
export function toMeshArrays(geometry) {
  const position = geometry.getAttribute('position');
  const positions = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    positions[i * 3] = position.getX(i);
    positions[i * 3 + 1] = position.getY(i);
    positions[i * 3 + 2] = position.getZ(i);
  }
  let indices;
  if (geometry.index) {
    indices = Uint32Array.from(geometry.index.array);
  } else {
    indices = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) { indices[i] = i; }
  }
  const result = { positions, indices };
  const normal = geometry.getAttribute('normal');
  if (normal) { result.normals = Float32Array.from(normal.array); }
  return result;
}

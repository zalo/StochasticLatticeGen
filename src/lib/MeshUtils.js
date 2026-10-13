import { BufferGeometry, Box3, DoubleSide, Ray, Vector3 } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { toGeometry } from './MeshArrays.js';

export { toGeometry, toMeshArrays } from './MeshArrays.js';

/**
 * Strips a mesh down to positions, welds coincident vertices and computes smooth normals.
 * The returned indexed geometry is what every lattice operation works on.
 * @param {BufferGeometry|import('./MeshArrays.js').MeshArrays} input
 * @param {object} [options]
 * @param {number} [options.weldTolerance] Absolute weld distance; defaults to 1e-6 of the bounding diagonal.
 */
export function prepareGeometry(input, { weldTolerance } = {}) {
  const source = toGeometry(input);
  const stripped = new BufferGeometry();
  stripped.setAttribute('position', source.getAttribute('position'));
  if (source.index) { stripped.setIndex(source.index); }
  stripped.computeBoundingBox();
  const diagonal = stripped.boundingBox.getSize(new Vector3()).length();
  const welded = mergeVertices(stripped, weldTolerance ?? diagonal * 1e-6);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  return welded;
}

/** Builds a bounding volume hierarchy for fast raycasts and closest-point queries. */
export function buildBVH(geometry) {
  return new MeshBVH(geometry);
}

/**
 * Displaces every vertex along its (smooth) normal. Positive distances grow the
 * mesh outward, negative distances shrink it. This is a cheap approximation of
 * a true offset surface, so when a `bvh` of the input is supplied each vertex's
 * travel is clamped to half the local mesh thickness in the direction of
 * travel: thin features then collapse to a sliver instead of turning inside out.
 * @param {BufferGeometry} geometry Welded geometry with vertex normals.
 * @param {number} distance
 * @param {object} [options]
 * @param {MeshBVH} [options.bvh] BVH of `geometry`; enables the thickness clamp.
 * @param {number} [options.clampFraction=0.49] Fraction of the local thickness a vertex may travel.
 */
export function offsetGeometry(geometry, distance, { bvh, clampFraction = 0.49 } = {}) {
  const result = geometry.clone();
  const position = result.getAttribute('position');
  const normal = result.getAttribute('normal');
  const ray = new Ray();
  const direction = Math.sign(distance);
  const skin = (geometry.boundingBox?.getSize(new Vector3()).length() ?? 1) * 1e-5;
  for (let i = 0; i < position.count; i++) {
    let travel = Math.abs(distance);
    if (bvh) {
      ray.origin.fromBufferAttribute(position, i);
      ray.direction.fromBufferAttribute(normal, i).multiplyScalar(direction);
      const hit = bvh.raycastFirst(ray, DoubleSide, skin);
      if (hit) { travel = Math.min(travel, hit.distance * clampFraction); }
    }
    position.setXYZ(i,
      position.getX(i) + normal.getX(i) * direction * travel,
      position.getY(i) + normal.getY(i) * direction * travel,
      position.getZ(i) + normal.getZ(i) * direction * travel);
  }
  position.needsUpdate = true;
  result.computeVertexNormals();
  result.computeBoundingBox();
  return result;
}

/** Returns every intersection of `ray` with the BVH (both triangle sides), sorted by distance. */
export function raycastAll(bvh, ray) {
  const hits = bvh.raycast(ray, DoubleSide);
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

// A fixed, slightly irrational direction avoids rays grazing mesh edges exactly.
const INSIDE_TEST_DIRECTION = new Vector3(0.577, 0.5776, 0.5773).normalize();

/** Parity test: a point is inside a closed mesh when a ray from it crosses the surface an odd number of times. */
export function isInside(bvh, point, ray) {
  ray.origin.copy(point);
  ray.direction.copy(INSIDE_TEST_DIRECTION);
  return bvh.raycast(ray, DoubleSide).length % 2 === 1;
}

/** Expands a box by a fraction of its diagonal (plus an optional absolute margin). */
export function expandedBounds(box, fraction = 0.02, margin = 0) {
  const diagonal = box.getSize(new Vector3()).length();
  return new Box3().copy(box).expandByScalar(diagonal * fraction + margin);
}

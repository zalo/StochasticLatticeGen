import { Line3, Matrix4, Ray, Vector3 } from 'three';
import { LatticeGraph } from './LatticeGraph.js';
import { buildBVH, raycastAll } from './MeshUtils.js';

/**
 * Clips every strut of `graph` against a closed mesh, keeping only the parts inside it.
 * Struts that cross the surface are cut at the crossing, so the result ends exactly on the surface.
 * @param {LatticeGraph} graph
 * @param {import('three-mesh-bvh').MeshBVH} bvh BVH of the clipping surface.
 * @param {object} [options]
 * @param {(stage: string, fraction: number) => void} [options.onProgress]
 * @returns {LatticeGraph} A new graph.
 */
export function trimGraphToMesh(graph, bvh, { onProgress } = {}) {
  const trimmed = new LatticeGraph({ tolerance: graph.tolerance });
  const a = new Vector3(), b = new Vector3(), previous = new Vector3();
  const ray = new Ray();
  const edgeCount = graph.edgeCount;
  for (let e = 0; e < edgeCount; e++) {
    a.fromArray(graph.positions, graph.edges[e * 2] * 3);
    b.fromArray(graph.positions, graph.edges[e * 2 + 1] * 3);
    const length = a.distanceTo(b);
    if (length === 0) { continue; }
    ray.origin.copy(a);
    ray.direction.subVectors(b, a).divideScalar(length);
    const hits = raycastAll(bvh, ray);
    // Parity of all crossings along the ray tells us whether the start is inside.
    let inside = hits.length % 2 === 1;
    previous.copy(a);
    for (const hit of hits) {
      if (hit.distance >= length) { break; }
      if (inside) { trimmed.addSegment(previous.x, previous.y, previous.z, hit.point.x, hit.point.y, hit.point.z); }
      previous.copy(hit.point);
      inside = !inside;
    }
    if (inside) { trimmed.addSegment(previous.x, previous.y, previous.z, b.x, b.y, b.z); }
    if (e % 2000 === 0) { onProgress?.('Trimming struts to surface', e / edgeCount); }
  }
  onProgress?.('Trimming struts to surface', 1);
  return trimmed;
}

/**
 * Adds the intersection curves between a set of faces and a surface to `graph`
 * (e.g. where Voronoi cell walls cut through the clipping mesh).
 * @param {LatticeGraph} graph Receives the contour segments.
 * @param {import('three-mesh-bvh').MeshBVH} surfaceBvh
 * @param {import('three').BufferGeometry} faceGeometry Triangulated faces to intersect with the surface.
 */
export function addSurfaceContours(graph, surfaceBvh, faceGeometry, { onProgress } = {}) {
  const faceBvh = buildBVH(faceGeometry);
  const edge = new Line3();
  let tested = 0;
  onProgress?.('Intersecting cell walls with surface', -1);
  surfaceBvh.bvhcast(faceBvh, new Matrix4(), {
    intersectsTriangles(surfaceTriangle, faceTriangle) {
      if (surfaceTriangle.intersectsTriangle(faceTriangle, edge)) {
        graph.addSegment(edge.start.x, edge.start.y, edge.start.z, edge.end.x, edge.end.y, edge.end.z);
      }
      if (++tested % 20000 === 0) { onProgress?.('Intersecting cell walls with surface', -1); }
      return false; // keep traversing
    },
  });
  onProgress?.('Intersecting cell walls with surface', 1);
  return graph;
}

import Module from 'manifold-3d';

let manifoldPromise = null;

/**
 * Loads (once) and returns the manifold-3d wasm module.
 * @param {object} [moduleOptions] Emscripten module options, e.g. `{ locateFile }`.
 */
export function loadManifold(moduleOptions) {
  if (!manifoldPromise) {
    manifoldPromise = Module(moduleOptions).then((wasm) => { wasm.setup(); return wasm; });
  }
  return manifoldPromise;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ICOSAHEDRON_VERTICES = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
const ICOSAHEDRON_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

function icosphereVertices(subdivisions) {
  let vertices = ICOSAHEDRON_VERTICES.map((v) => [...v]);
  let faces = ICOSAHEDRON_FACES.map((f) => [...f]);
  for (let s = 0; s < subdivisions; s++) {
    const midpoints = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let index = midpoints.get(key);
      if (index === undefined) {
        const [ax, ay, az] = vertices[a], [bx, by, bz] = vertices[b];
        const mx = ax + bx, my = ay + by, mz = az + bz;
        const l = Math.hypot(mx, my, mz);
        index = vertices.length;
        vertices.push([mx / l, my / l, mz / l]);
        midpoints.set(key, index);
      }
      return index;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return vertices;
}

/**
 * Unit-size point clouds that get swept along each strut. The convex hull of
 * the profile placed at both strut ends forms the strut solid.
 */
export const STRUT_PROFILES = Object.freeze({
  /** 8 points: an axis-aligned cube with half-extent `radius`. */
  cube: () => [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]],
  /** 12 points: an icosahedron with circumradius `radius`. */
  icosahedron: () => icosphereVertices(0),
  /** 42 points: a once-subdivided icosphere with radius `radius`. */
  icosphere: () => icosphereVertices(1),
});

/** Returns the scaled profile points for a given profile name (or a custom unit point array). */
export function profilePoints(profile, radius) {
  const unit = typeof profile === 'string' ? STRUT_PROFILES[profile]?.() : profile;
  if (!unit) { throw new Error(`Unknown strut profile "${profile}"; expected one of ${Object.keys(STRUT_PROFILES).join(', ')}`); }
  return unit.map(([x, y, z]) => [x * radius, y * radius, z * radius]);
}

/**
 * Sweeps a profile along every strut of a graph and unions the sweeps into a
 * single watertight manifold mesh.
 *
 * Each strut becomes the convex hull of the profile placed at both of its
 * endpoints (a capsule-like solid), and the hulls are batch-unioned with
 * manifold-3d, which guarantees a 2-manifold result with clean junctions.
 *
 * The hulls are unioned in chunks and the chunk results unioned once more.
 * Measured on a 21k-strut armadillo lattice this runs ~30% faster than one
 * batch union of every hull (13.3 s vs 19.3 s); a deeper pairwise merge tree,
 * chunk sizes from 100 to 512, and Morton-ordering the struts spatially made
 * no further measurable difference, so the flat two-level scheme is kept.
 *
 * @param {{ positions: ArrayLike<number>, edges: ArrayLike<number> }} graph
 * @param {object} [options]
 * @param {number} [options.radius=1] Half the strut thickness.
 * @param {'cube'|'icosahedron'|'icosphere'|number[][]} [options.profile='icosahedron']
 * @param {number} [options.chunkSize=512] Struts per intermediate union.
 * @param {(stage: string, fraction: number) => void} [options.onProgress]
 * @param {object} [options.manifoldOptions] Passed to `loadManifold` on first use.
 * @returns {Promise<{ positions: Float32Array, indices: Uint32Array }>}
 */
export async function sweepGraph(graph, { radius = 1, profile = 'icosahedron', chunkSize = 512, onProgress, manifoldOptions } = {}) {
  const { Manifold } = await loadManifold(manifoldOptions);
  const { positions, edges } = graph;
  const template = profilePoints(profile, radius);
  const edgeCount = edges.length / 2;
  if (edgeCount === 0) { return { positions: new Float32Array(0), indices: new Uint32Array(0) }; }

  const parts = [];
  const chunks = Math.ceil(edgeCount / chunkSize);
  for (let chunk = 0; chunk < chunks; chunk++) {
    const hulls = [];
    const end = Math.min(edgeCount, (chunk + 1) * chunkSize);
    for (let e = chunk * chunkSize; e < end; e++) {
      const a = edges[e * 2] * 3, b = edges[e * 2 + 1] * 3;
      const points = new Array(template.length * 2);
      for (let i = 0; i < template.length; i++) {
        const [x, y, z] = template[i];
        points[i * 2] = [positions[a] + x, positions[a + 1] + y, positions[a + 2] + z];
        points[i * 2 + 1] = [positions[b] + x, positions[b + 1] + y, positions[b + 2] + z];
      }
      hulls.push(Manifold.hull(points));
    }
    const part = hulls.length === 1 ? hulls[0] : Manifold.union(hulls);
    part.numTri(); // force evaluation now so progress reflects real work
    if (hulls.length > 1) { hulls.forEach((h) => h.delete()); }
    parts.push(part);
    onProgress?.('Unioning struts', (chunk + 1) / (chunks + 1));
  }

  const solid = parts.length === 1 ? parts[0] : Manifold.union(parts);
  const mesh = solid.getMesh();
  if (parts.length > 1) { parts.forEach((p) => p.delete()); }
  solid.delete();
  onProgress?.('Unioning struts', 1);

  const vertexCount = mesh.vertProperties.length / mesh.numProp;
  const outPositions = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    outPositions[v * 3] = mesh.vertProperties[v * mesh.numProp];
    outPositions[v * 3 + 1] = mesh.vertProperties[v * mesh.numProp + 1];
    outPositions[v * 3 + 2] = mesh.vertProperties[v * mesh.numProp + 2];
  }
  return { positions: outPositions, indices: Uint32Array.from(mesh.triVerts) };
}

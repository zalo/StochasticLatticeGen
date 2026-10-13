/** Serialises a flat xyz point array to an ASCII PLY point cloud. */
export function pointsToPLY(positions) {
  const count = positions.length / 3;
  const lines = [
    'ply', 'format ascii 1.0', `element vertex ${count}`,
    'property float x', 'property float y', 'property float z', 'end_header',
  ];
  for (let i = 0; i < count; i++) {
    lines.push(`${positions[i * 3]} ${positions[i * 3 + 1]} ${positions[i * 3 + 2]}`);
  }
  return lines.join('\n') + '\n';
}

/** Serialises a strut graph (`{ positions, edges }`) to an ASCII PLY with vertex and edge elements. */
export function graphToPLY({ positions, edges }) {
  const vertexCount = positions.length / 3;
  const edgeCount = edges.length / 2;
  const lines = [
    'ply', 'format ascii 1.0',
    `element vertex ${vertexCount}`, 'property float x', 'property float y', 'property float z',
    `element edge ${edgeCount}`, 'property int vertex1', 'property int vertex2', 'end_header',
  ];
  for (let i = 0; i < vertexCount; i++) {
    lines.push(`${positions[i * 3]} ${positions[i * 3 + 1]} ${positions[i * 3 + 2]}`);
  }
  for (let e = 0; e < edgeCount; e++) {
    lines.push(`${edges[e * 2]} ${edges[e * 2 + 1]}`);
  }
  return lines.join('\n') + '\n';
}

/** Serialises an indexed triangle mesh (`{ positions, indices }`) to binary STL. */
export function meshToSTL({ positions, indices }, { name = 'lattice' } = {}) {
  const triangleCount = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    view.setFloat32(offset, nx, true); view.setFloat32(offset + 4, ny, true); view.setFloat32(offset + 8, nz, true);
    offset += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(offset, positions[v], true);
      view.setFloat32(offset + 4, positions[v + 1], true);
      view.setFloat32(offset + 8, positions[v + 2], true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buffer;
}

/** Serialises an indexed triangle mesh (`{ positions, indices }`) to Wavefront OBJ text. */
export function meshToOBJ({ positions, indices }, { name = 'lattice' } = {}) {
  const lines = [`o ${name}`];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
  }
  for (let i = 0; i < indices.length; i += 3) {
    lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`);
  }
  return lines.join('\n') + '\n';
}

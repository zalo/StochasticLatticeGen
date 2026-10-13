import * as THREE from 'three';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { USDZLoader } from 'three/addons/loaders/USDZLoader.js';
import { deinterleaveAttribute, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { World } from './World.js';
import { WorkerClient } from './WorkerClient.js';
import { toGeometry, toMeshArrays } from '../lib/MeshArrays.js';
import { graphToPLY, meshToOBJ, meshToSTL, pointsToPLY } from '../lib/Exporters.js';

const DEFAULT_MESH_URL = 'assets/armadillo.obj';
const LOADERS = { obj: OBJLoader, gltf: GLTFLoader, glb: GLTFLoader, fbx: FBXLoader, stl: STLLoader, usdz: USDZLoader };
const PLACEMENT_OPTIONS = { Surface: 'surface', Exterior: 'exterior', Interior: 'interior' };
const SAMPLE_MODE_OPTIONS = { Surface: 'surface', Volume: 'volume' };
const CLIP_MODE_OPTIONS = { Unconstrained: 'unconstrained', Trimmed: 'trimmed', Conforming: 'conforming', 'Surface Only': 'surface' };
const PROFILE_OPTIONS = { 'Cube (8 pts)': 'cube', 'Icosahedron (12 pts)': 'icosahedron', 'Icosphere (42 pts)': 'icosphere' };

/** Interactive front-end: loads meshes, drives the lattice worker and renders/exports the results. */
class LatticeDemo {
  constructor() {
    this.params = {
      showMesh: true,
      placement: 'surface',
      customOffset: false,
      offset: 0,
      showOffsetSurface: false,
      sampleMode: 'surface',
      pointCount: 500,
      seed: 1,
      showPoints: false,
      clipping: 'conforming',
      pruneIslands: false,
      thickness: 1,
      profile: 'icosahedron',
    };
    this.meshName = 'lattice';
    this.scale = 1;
    this.appliedOffset = 0; // offset the worker's clipping surface currently uses
    this.points = null;   // Float32Array of seed positions
    this.graph = null;    // { positions, edges } of the current lattice
    this.solid = null;    // { positions, indices } of the swept strut mesh
    this.objects = {};    // scene objects keyed by role
    this.queue = Promise.resolve();

    this.statusElement = document.getElementById('status');
    this.errorElement = document.getElementById('errors');
    this.world = new World(document.getElementById('appbody'));
    this.worker = new WorkerClient(new URL('./LatticeWorker.js', import.meta.url), {
      onProgress: (stage, fraction) => this.showProgress(stage, fraction),
    });

    // Kept deliberately low-poly: lattices routinely have 50k+ joints and struts in the preview.
    this.unitSphere = new THREE.IcosahedronGeometry(1, 1);
    this.unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.strutMaterial = new THREE.MeshStandardMaterial({ color: 0x33cc55, roughness: 0.8 });
    this.pointMaterial = new THREE.MeshStandardMaterial({ color: 0xff2020, roughness: 1 });

    this.buildGUI();
    this.installErrorOverlay();
    this.installDropTarget();
    this.worker.ready
      .then(() => this.loadMeshFromURL(DEFAULT_MESH_URL))
      .catch((error) => this.showError(error));
  }

  // ---------------------------------------------------------------- GUI

  buildGUI() {
    const { params } = this;
    const gui = new GUI({ title: 'Stochastic Lattice' });
    const resample = () => this.enqueue(() => this.resample());
    const rebuild = () => this.enqueue(() => this.rebuild());
    const updateOffset = () => this.enqueue(() => this.updateOffset());

    const meshFolder = gui.addFolder('Mesh');
    meshFolder.add(params, 'showMesh').name('Show Mesh')
      .onChange((visible) => { if (this.objects.mesh) { this.objects.mesh.visible = visible; } });
    meshFolder.add(params, 'placement', PLACEMENT_OPTIONS).name('Placement').onFinishChange(updateOffset);
    meshFolder.add(params, 'customOffset').name('Custom Offset').onChange((custom) => {
      if (custom) { params.offset = this.appliedOffset; this.offsetController.updateDisplay(); }
      this.offsetController.show(custom);
      updateOffset();
    });
    this.offsetController = meshFolder.add(params, 'offset', -1, 1, 0.001).name('Offset (in ← → out)')
      .onFinishChange(updateOffset).show(false);
    meshFolder.add(params, 'showOffsetSurface').name('Show Offset Surface')
      .onChange((visible) => { if (this.objects.offsetSurface) { this.objects.offsetSurface.visible = visible; } });

    const seedFolder = gui.addFolder('Seed Points');
    seedFolder.add(params, 'sampleMode', SAMPLE_MODE_OPTIONS).name('Sample In').onFinishChange(resample);
    seedFolder.add(params, 'pointCount', 5, 5000, 1).name('Point Count').onFinishChange(resample);
    seedFolder.add(params, 'seed', 0, 9999, 1).name('Random Seed').onFinishChange(resample);
    seedFolder.add(params, 'showPoints').name('Show Points')
      .onChange((visible) => { if (this.objects.points) { this.objects.points.visible = visible; } });

    const latticeFolder = gui.addFolder('Lattice');
    latticeFolder.add(params, 'clipping', CLIP_MODE_OPTIONS).name('Clipping').onFinishChange(rebuild);
    latticeFolder.add(params, 'pruneIslands').name('Prune Islands').onFinishChange(rebuild);

    const strutFolder = gui.addFolder('Struts');
    this.thicknessController = strutFolder.add(params, 'thickness', 0.01, 1, 0.001).name('Thickness')
      .onChange(() => this.updateStrutThickness())
      .onFinishChange(() => { this.clearSolid(); updateOffset(); }); // Exterior/Interior placement follows the thickness
    strutFolder.add(params, 'profile', PROFILE_OPTIONS).name('Sweep Profile').onFinishChange(() => this.clearSolid());
    strutFolder.add({ build: () => this.enqueue(() => this.buildSolid()) }, 'build').name('Build Strut Mesh');

    const exportFolder = gui.addFolder('Export');
    const actions = {
      points: () => this.exportPoints(),
      edges: () => this.exportEdges(),
      stl: () => this.enqueue(() => this.exportSolid('stl')),
      obj: () => this.enqueue(() => this.exportSolid('obj')),
    };
    exportFolder.add(actions, 'points').name('Seed Points (.ply)');
    exportFolder.add(actions, 'edges').name('Lattice Edges (.ply)');
    exportFolder.add(actions, 'stl').name('Strut Mesh (.stl)');
    exportFolder.add(actions, 'obj').name('Strut Mesh (.obj)');
    this.gui = gui;
  }

  /** Adapts the dimensional sliders to the size of the loaded mesh. */
  fitControlsToScale(scale) {
    const previousScale = this.scale;
    this.scale = scale;
    this.offsetController.min(-0.1 * scale).max(0.1 * scale).step(scale / 1000);
    this.thicknessController.min(0.0005 * scale).max(0.05 * scale).step(scale / 2000);
    if (previousScale !== scale) {
      this.params.offset = 0;
      this.params.thickness = 0.005 * scale;
    }
    this.offsetController.updateDisplay();
    this.thicknessController.updateDisplay();
  }

  // ---------------------------------------------------------------- pipeline

  /** Serialises worker jobs so GUI changes never race each other. */
  enqueue(job) {
    this.queue = this.queue.then(job).catch((error) => this.showError(error));
    return this.queue;
  }

  async setMesh(geometry, name) {
    this.meshName = name.replace(/\.[^.]+$/, '');
    const mesh = toMeshArrays(geometry);
    const info = await this.worker.call('setMesh', { mesh, offset: 0 }, [mesh.positions.buffer, mesh.indices.buffer]);
    this.appliedOffset = 0;
    this.fitControlsToScale(info.scale);
    this.showMesh(info);
    await this.applyOffset();
    await this.resample();
  }

  /**
   * The clipping-surface offset implied by the settings: a custom value, or half the strut
   * thickness outward (Exterior) / inward (Interior) so the struts sit tangent to the surface.
   */
  effectiveOffset() {
    const { customOffset, offset, placement, thickness } = this.params;
    if (customOffset) { return offset; }
    if (placement === 'exterior') { return thickness / 2; }
    if (placement === 'interior') { return -thickness / 2; }
    return 0;
  }

  /** Pushes the effective offset to the worker if it changed; returns whether it did. */
  async applyOffset() {
    const offset = this.effectiveOffset();
    if (offset === this.appliedOffset) { return false; }
    const info = await this.worker.call('setOffset', { offset });
    this.appliedOffset = offset;
    this.showOffsetSurface(info.clipMesh);
    return true;
  }

  async updateOffset() {
    if (await this.applyOffset()) { await this.resample(); }
  }

  async resample() {
    const { sampleMode: mode, pointCount: count, seed } = this.params;
    this.points = await this.worker.call('samplePoints', { mode, count, seed });
    this.showPoints(this.points);
    await this.rebuild();
  }

  async rebuild() {
    const points = this.points.slice();
    const { clipping, pruneIslands } = this.params;
    this.graph = await this.worker.call('computeLattice', { points, clipping, pruneIslands }, [points.buffer]);
    this.clearSolid();
    this.showStruts(this.graph);
    this.showStatus(`${this.graph.edges.length / 2} struts, ${this.graph.positions.length / 3} joints`);
  }

  async buildSolid() {
    if (!this.graph) { return null; }
    const graph = { positions: this.graph.positions.slice(), edges: this.graph.edges.slice() };
    const { thickness, profile } = this.params;
    this.solid = await this.worker.call('sweep', { graph, radius: thickness / 2, profile }, [graph.positions.buffer, graph.edges.buffer]);
    this.showSolid(this.solid);
    this.showStatus(`Strut mesh: ${this.solid.indices.length / 3} triangles, ${this.solid.positions.length / 3} vertices`);
    return this.solid;
  }

  // ---------------------------------------------------------------- scene objects

  replaceObject(role, object) {
    const previous = this.objects[role];
    if (previous) {
      this.world.scene.remove(previous);
      previous.geometry?.dispose();
      if (previous.isInstancedMesh) { previous.dispose(); }
    }
    this.objects[role] = object;
    if (object) { this.world.scene.add(object); }
    return object;
  }

  showMesh(info) {
    const geometry = toGeometry(info.baseMesh);
    const material = new THREE.MeshPhysicalMaterial({ color: 0xf78a1d, transparent: true, opacity: 0.5 });
    const mesh = this.replaceObject('mesh', new THREE.Mesh(geometry, material));
    mesh.visible = this.params.showMesh;
    this.world.frame(new THREE.Box3(new THREE.Vector3().fromArray(info.bounds.min), new THREE.Vector3().fromArray(info.bounds.max)));
    this.showOffsetSurface(info.clipMesh);
  }

  showOffsetSurface(clipMesh) {
    if (!clipMesh) { this.replaceObject('offsetSurface', null); return; }
    const material = new THREE.MeshBasicMaterial({ color: 0x2255ff, wireframe: true, transparent: true, opacity: 0.2 });
    const surface = this.replaceObject('offsetSurface', new THREE.Mesh(toGeometry(clipMesh), material));
    surface.visible = this.params.showOffsetSurface;
  }

  showPoints(points) {
    const count = points.length / 3;
    const instances = this.replaceObject('points', new THREE.InstancedMesh(this.unitSphere, this.pointMaterial, count));
    const matrix = new THREE.Matrix4();
    const radius = this.params.thickness * 0.75;
    for (let i = 0; i < count; i++) {
      matrix.makeScale(radius, radius, radius).setPosition(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      instances.setMatrixAt(i, matrix);
    }
    instances.visible = this.params.showPoints;
  }

  /** Previews the lattice as instanced cylinders with spherical joints. */
  showStruts(graph) {
    const edgeCount = graph.edges.length / 2;
    const vertexCount = graph.positions.length / 3;
    const struts = this.replaceObject('struts', new THREE.InstancedMesh(this.unitCylinder, this.strutMaterial, edgeCount));
    const joints = this.replaceObject('joints', new THREE.InstancedMesh(this.unitSphere, this.strutMaterial, vertexCount));
    struts.castShadow = true; // joints are tiny; skipping their shadow pass halves the preview cost
    struts.receiveShadow = joints.receiveShadow = true;
    this.updateStrutThickness();
  }

  /** Re-poses the strut preview instances for the current thickness (cheap enough to run while dragging). */
  updateStrutThickness() {
    const { struts, joints } = this.objects;
    if (!struts || !this.graph) { return; }
    const { positions, edges } = this.graph;
    const radius = this.params.thickness / 2;
    const matrix = new THREE.Matrix4();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), direction = new THREE.Vector3(), scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let e = 0; e < edges.length / 2; e++) {
      a.fromArray(positions, edges[e * 2] * 3);
      b.fromArray(positions, edges[e * 2 + 1] * 3);
      direction.subVectors(b, a);
      const length = direction.length();
      rotation.setFromUnitVectors(up, direction.divideScalar(length || 1));
      matrix.compose(a.lerp(b, 0.5), rotation, scale.set(radius, length, radius));
      struts.setMatrixAt(e, matrix);
    }
    for (let v = 0; v < positions.length / 3; v++) {
      matrix.makeScale(radius, radius, radius).setPosition(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      joints.setMatrixAt(v, matrix);
    }
    struts.instanceMatrix.needsUpdate = true;
    joints.instanceMatrix.needsUpdate = true;
    if (this.objects.points) { this.showPoints(this.points); }
  }

  showSolid(solid) {
    const geometry = toGeometry(solid);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0x33cc55, roughness: 0.6, flatShading: true });
    const mesh = this.replaceObject('solid', new THREE.Mesh(geometry, material));
    mesh.castShadow = mesh.receiveShadow = true;
    this.setPreviewVisible(false);
  }

  /** Drops the swept mesh (it no longer matches the lattice or strut settings). */
  clearSolid() {
    this.solid = null;
    this.replaceObject('solid', null);
    this.setPreviewVisible(true);
  }

  setPreviewVisible(visible) {
    if (this.objects.struts) { this.objects.struts.visible = visible; }
    if (this.objects.joints) { this.objects.joints.visible = visible; }
  }

  // ---------------------------------------------------------------- export

  exportPoints() {
    if (!this.points) { return; }
    download(new Blob([pointsToPLY(this.points)], { type: 'text/plain' }), `${this.meshName}-seeds.ply`);
  }

  exportEdges() {
    if (!this.graph) { return; }
    download(new Blob([graphToPLY(this.graph)], { type: 'text/plain' }), `${this.meshName}-lattice-edges.ply`);
  }

  async exportSolid(format) {
    const solid = this.solid ?? await this.buildSolid();
    if (!solid) { return; }
    const name = `${this.meshName}-lattice`;
    if (format === 'stl') {
      download(new Blob([meshToSTL(solid, { name })], { type: 'application/octet-stream' }), `${name}.stl`);
    } else {
      download(new Blob([meshToOBJ(solid, { name })], { type: 'text/plain' }), `${name}.obj`);
    }
  }

  // ---------------------------------------------------------------- loading

  async loadMeshFromURL(url, name = url.split('/').pop()) {
    const extension = name.toLowerCase().split('.').pop();
    const Loader = LOADERS[extension];
    if (!Loader) { throw new Error(`Unsupported file type ".${extension}" (expected ${Object.keys(LOADERS).join(', ')})`); }
    const loaded = await new Loader().loadAsync(url, (event) => {
      this.showProgress(`Loading ${name}`, event.total ? event.loaded / event.total : -1);
    });
    const geometry = collectGeometry(loaded.scene ?? loaded);
    await this.enqueue(() => this.setMesh(geometry, name));
  }

  installDropTarget() {
    document.body.addEventListener('dragover', (event) => event.preventDefault());
    document.body.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = [...event.dataTransfer.files][0];
      if (!file) { return; }
      const url = URL.createObjectURL(file);
      this.loadMeshFromURL(url, file.name)
        .catch((error) => this.showError(error))
        .finally(() => URL.revokeObjectURL(url));
    });
  }

  // ---------------------------------------------------------------- status

  showProgress(stage, fraction) {
    this.statusElement.replaceChildren();
    this.statusElement.append(stage);
    const bar = document.createElement('progress');
    if (fraction >= 0) { bar.max = 1; bar.value = fraction; }
    this.statusElement.append(bar);
  }

  showStatus(text) {
    this.statusElement.textContent = text;
  }

  installErrorOverlay() {
    window.addEventListener('error', (event) => this.showError(event.error ?? event.message));
    window.addEventListener('unhandledrejection', (event) => this.showError(event.reason));
  }

  showError(error) {
    console.error(error);
    const line = document.createElement('div');
    line.textContent = String(error?.message ?? error);
    this.errorElement.append(line);
  }
}

/** Flattens every mesh in a loaded scene (or a bare geometry) into one world-space, position-only geometry. */
function collectGeometry(loaded) {
  if (loaded.isBufferGeometry) { return loaded; }
  loaded.updateMatrixWorld(true);
  const parts = [];
  loaded.traverse((child) => {
    if (!child.isMesh) { return; }
    let position = child.geometry.getAttribute('position');
    if (position.isInterleavedBufferAttribute) { position = deinterleaveAttribute(position); }
    const part = new THREE.BufferGeometry();
    part.setAttribute('position', position.clone());
    if (child.geometry.index) { part.setIndex(child.geometry.index.clone()); }
    part.applyMatrix4(child.matrixWorld);
    parts.push(part.index ? part.toNonIndexed() : part);
  });
  if (parts.length === 0) { throw new Error('No mesh found in the loaded file'); }
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Exposed for debugging from the console.
window.demo = new LatticeDemo();

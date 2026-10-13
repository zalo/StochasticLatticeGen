import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** A lit, shadowed three.js scene with orbit controls that can re-frame itself around any bounding box. */
export class World {
  /**
   * @param {HTMLElement} container Element that receives the canvas and stats overlay.
   * @param {() => void} [onFrame] Called before every render.
   */
  constructor(container, onFrame) {
    this.container = container;
    this.onFrame = onFrame;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xafb6c8);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    this.scene.add(this.camera);

    this.spotLight = new THREE.SpotLight(0xffffff, 2.5);
    this.spotLight.angle = Math.PI / 5;
    this.spotLight.penumbra = 0.2;
    this.spotLight.decay = 0;
    this.spotLight.castShadow = true;
    this.spotLight.shadow.mapSize.set(2048, 2048);
    this.spotLight.shadow.bias = -0.0005;
    this.scene.add(this.spotLight, this.spotLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    this.scene.add(this.hemiLight);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshPhongMaterial({ color: 0xa0adaf, shininess: 150 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(1, 20);
    this.scene.add(this.grid);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;

    this.stats = new Stats();
    this.container.appendChild(this.stats.dom);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.frame(new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)));
    this.renderer.setAnimationLoop(() => this.render());
  }

  /** Repositions camera, lights and ground so that `box` (world space) fills the view. */
  frame(box) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const diagonal = size.length() || 1;

    this.ground.scale.setScalar(diagonal * 8);
    this.ground.position.set(center.x, box.min.y - diagonal * 0.002, center.z);
    this.grid.scale.setScalar(diagonal * 8);
    this.grid.position.set(center.x, box.min.y - diagonal * 0.001, center.z);

    this.camera.near = diagonal * 0.005;
    this.camera.far = diagonal * 50;
    this.camera.position.set(center.x + diagonal * 0.1, center.y + diagonal * 0.4, center.z - diagonal * 1.0);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();

    this.spotLight.position.set(center.x - diagonal * 0.8, center.y + diagonal * 1.5, center.z - diagonal * 1.0);
    this.spotLight.target.position.copy(center);
    this.spotLight.shadow.camera.near = diagonal * 0.1;
    this.spotLight.shadow.camera.far = diagonal * 5;
    this.spotLight.shadow.camera.updateProjectionMatrix();
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render() {
    this.onFrame?.();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.stats.update();
  }
}

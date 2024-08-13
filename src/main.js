import * as THREE from '../node_modules/three/build/three.module.js';
import { GUI } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import World from './World.js';
import { OBJLoader } from '../node_modules/three/examples/jsm/loaders/OBJLoader.js';
import { Voro3D } from '../assets/voro3d/dist/index.js';
import { MeshSurfaceSampler } from '../node_modules/three/examples/jsm/math/MeshSurfaceSampler.js';
import { Worker } from "../node_modules/worker-with-import-map/src/index.js";

// Import the BVH Acceleration Structure and monkey-patch the Mesh class with it
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, SAH } from '../node_modules/three-mesh-bvh/build/index.module.js';
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

/** The fundamental set up and animation structures for 3D Visualization */
export default class Main {

    constructor() {
        // Intercept Main Window Errors
        window.realConsoleError = console.error;
        window.addEventListener('error', (event) => {
            let path = event.filename.split("/");
            this.display((path[path.length - 1] + ":" + event.lineno + " - " + event.message));
        });
        console.error = this.fakeError.bind(this);
        this.deferredConstructor();
    }
    async deferredConstructor() {
        // Configure Settings
        this.latticeParams = {
            loadMesh: this.loadMesh.bind(this),
            showMesh: true,
            voronoiMode: 0,
            numPoints: 500,
            showPoints: false,
            latticeMode: 0,
        };
        this.gui = new GUI();
        this.gui.add(this.latticeParams, 'loadMesh' ).name( 'Load Mesh' );
        this.gui.add(this.latticeParams, 'showMesh').name( 'Show Mesh' ).onFinishChange(async (value) => {
            if(this.mesh){ this.mesh.visible = value; }});
        this.gui.add(this.latticeParams, 'voronoiMode', { Surface: 0, Volume: 1 } ).name( 'Sampling Mode' ).onFinishChange(async (value) => {
            if(this.mesh){ this.points = await this.samplePoints(this.mesh); this.generateLattice(this.points); }});
        this.gui.add(this.latticeParams, 'numPoints', 5, 5000, 1).name( 'Num Points' ).onFinishChange(async (value) => {
            if(this.mesh){ this.points = await this.samplePoints(this.mesh); this.generateLattice(this.points); }});
        this.gui.add(this.latticeParams, 'showPoints').name( 'Show Points' ).onFinishChange(async (value) => {
            if(this.voronoiSpheres){ this.voronoiSpheres.visible = value; }});
        this.gui.add(this.latticeParams, 'latticeMode', { Unconstrained: 2, Trimmed: 1, Conforming: 0, Surface: -1 } ).name( 'Lattice Clipping Mode' ).onFinishChange(async (value) => {
            if(this.mesh){ this.generateLattice(this.points); }});
        //this.gui.add(this.meshingParams, 'TargetTriangles', 100, 5000, 100).onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});
        //this.gui.add(this.meshingParams, 'MaxTriangleEdgeLength').onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});
        //this.gui.add(this.meshingParams, 'MinTetVolume').onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});

        this.sphereGeo   = new THREE.SphereGeometry  (1.0, 32, 32);
        this.cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);

        this.status = document.getElementById("info");
        this.points = [];

        this.activePromises = {};
        this.worker = new Worker("../assets/worker.js", { type: "module" });
        this.worker.onmessage = (e) => {
            if(e.data.type === "Initialized") {
                console.log("Worker is ready!");
                this.worker.postMessage({ type: "Debug", data: "Helloooooooo!" });
                this.loadMesh("ArmadilloMesh"); // Now that the worker is ready, we can load the initial mesh...
            }else if(e.data.type === "Progress") {
                this.updateProgress(e.data.message, e.data.progress, 1);
            } else {
                console.log("Message received from worker", e.data);
                // Find the matching promise and resolve it
                if (e.data.type in this.activePromises) {
                    this.activePromises[e.data.type].resolve(e.data.result);
                    delete this.activePromises[e.data.type];
                }
            }
        };

        // Construct the render world
        this.world = new World(this);
    }

    updateProgress(progressText, current, max){
        this.status.innerHTML = progressText + " - <progress value='" + current + "' max='"+max+"'></progress>";
    }

    async loadMesh(meshName) {
        new OBJLoader().load( './assets/armadillo.obj',
            async ( object ) => {
                if(this.mesh){ this.world.scene.remove(this.mesh); this.mesh.geometry .dispose(); this.mesh.material .dispose(); this.world.scaleScene(1.0/this.sceneScale); }
                if(this.voronoiSpheres  ){ this.world.scene.remove(this.voronoiSpheres)  ; this.voronoiSpheres  .dispose(); }
                if(this.tetMesh         ){ this.world.scene.remove(this.tetMesh)         ; }
                if(this.voronoiGeo  ){ this.voronoiGeo.dispose();}
                if(this.latticeCylinders){ this.world.scene.remove(this.latticeCylinders); this.latticeCylinders.dispose(); }
                if(this.line            ){ this.world.scene.remove(this.line)            ; this.line.geometry   .dispose(); }
        
                // STEP 0. Create the Mesh and place it in the scene
                this.mesh = object.children[0];
                this.mesh.name = meshName;
                this.mesh.material = new THREE.MeshPhysicalMaterial({ color: 0xf78a1d, transparent: true, opacity: 0.5, side: THREE.FrontSide });
                this.world.scene.add( this.mesh );
                console.log("Building BVH...");
                this.mesh.geometry.computeBoundsTree( { maxLeafTris: 1, strategy: SAH } ); 

                let bbox = new THREE.Box3().setFromObject(this.mesh, true);
                this.sceneScale = bbox.getSize(new THREE.Vector3()).length() / 3.0;
                this.world.scaleScene(this.sceneScale);

                await this.sendWorkerRequest("StoreMesh", this.serializeMesh(this.mesh));

                //await this.generateLattice(this.mesh);
                this.points = await this.samplePoints(this.mesh);

                await this.generateLattice(this.points);
            },
            async ( xhr    ) => { this.updateProgress("Loading Mesh: ", xhr.loaded, xhr.total); },
            async ( error  ) => { console.log( 'A loading error happened', error );  }
        );
    }

    async sendWorkerRequest(requestType, data){
        return new Promise((resolve, reject) => {
            if (!(requestType in this.activePromises)) {
                this.activePromises[requestType] = { resolve, reject };
                this.worker.postMessage({ type: requestType, data: data });
            } else {
                reject("Request Type Already Active!");
            }
        });
    }

    async samplePoints(mesh){
        // STEP 1. Sample a uniform distribution of points on the surface or within the volume of the mesh

        let tempVec        = new THREE.Vector3();
        let tempMat        = new THREE.Matrix4();
        let zeroRotation   = new THREE.Quaternion();
        let scale          = new THREE.Vector3( 1, 1, 1 ).multiplyScalar(0.004 * this.sceneScale);

        let points = [];
        if(this.latticeParams.voronoiMode === 0){        // Voronoi Mode 0: Sample on the surface
            points = await this.sendWorkerRequest("SamplePointsOnMesh"  , { mesh: mesh.name, numPoints: this.latticeParams.numPoints });
        } else if(this.latticeParams.voronoiMode === 1){ // Voronoi Mode 1: Sample within the volume
            points = await this.sendWorkerRequest("SamplePointsInVolume", { mesh: mesh.name, numPoints: this.latticeParams.numPoints });
        }

        if(this.voronoiSpheres  ){ this.world.scene.remove(this.voronoiSpheres)  ; this.voronoiSpheres  .dispose(); }
        if(this.tetMesh         ){ this.world.scene.remove(this.tetMesh)         ; }
        if(this.voronoiGeo  ){ this.voronoiGeo.dispose();}
        if(this.latticeCylinders){ this.world.scene.remove(this.latticeCylinders); this.latticeCylinders.dispose(); }
        if(this.line            ){ this.world.scene.remove(this.line)            ; this.line.geometry   .dispose(); }

        this.voronoiSpheres = new THREE.InstancedMesh( this.sphereGeo, new THREE.MeshStandardMaterial( { color: 0xff0000, roughness: 1, metalness: 0 } ), this.latticeParams.numPoints );
        this.voronoiSpheres.castShadow    = true;
        this.voronoiSpheres.receiveShadow = true;
        this.voronoiSpheres.visible       = false;
        this.world.scene.add( this.voronoiSpheres );

        // Set the positions of the visual spheres in the instanced mesh
        for(let i = 0; i < points.length; i+=3){
            this.voronoiSpheres.setMatrixAt( i / 3, tempMat.compose( tempVec.set(points[i], points[i+1], points[i+2] ), zeroRotation, scale));
        }
        this.voronoiSpheres.instanceMatrix.needsUpdate = true;

        return points;
    }

    async generateLattice(points){
        // STEP 2. Generate the Voronoi Lattice from the sampled points
        let connections = await this.sendWorkerRequest("CreateVoronoiLattice"  , { mesh: this.mesh.name, points: points, mode: this.latticeParams.latticeMode });

        if(this.tetMesh         ){ this.world.scene.remove(this.tetMesh)         ; }
        //if(this.voronoiSpheres  ){ this.world.scene.remove(this.voronoiSpheres)  ; this.voronoiSpheres  .dispose(); }
        if(this.voronoiGeo  ){ this.voronoiGeo.dispose();}
        if(this.latticeCylinders){ this.world.scene.remove(this.latticeCylinders); this.latticeCylinders.material.dispose(); this.latticeCylinders.dispose(); }
        if(this.line            ){ this.world.scene.remove(this.line)            ; this.line.geometry   .dispose(); }

        let tempMat         = new THREE.Matrix4();
        let tempVec         = new THREE.Vector3();
        let tempVec2        = new THREE.Vector3();
        let tempRotation    = new THREE.Quaternion();
        let yVec            = new THREE.Vector3(0, 1, 0);
        let scale           = new THREE.Vector3( 1.0, 1, 1.0 ).multiplyScalar(0.004 * this.sceneScale);
        this.latticeCylinders = new THREE.InstancedMesh( this.cylinderGeo, 
            new THREE.MeshStandardMaterial( { color: 0x00ff00, roughness: 1, metalness: 0 } ), connections.length );
        this.latticeCylinders.castShadow    = true;
        this.latticeCylinders.receiveShadow = true;
        this.world.scene.add( this.latticeCylinders );

        // Set the cylimder positions and rotations according to the connection start/end points
        for(let i = 0; i < connections.length; i++){
            let x = (connections[i][0] + connections[i][3]) * 0.5;
            let y = (connections[i][1] + connections[i][4]) * 0.5;
            let z = (connections[i][2] + connections[i][5]) * 0.5;

            let xd = (connections[i][0] - connections[i][3]);
            let yd = (connections[i][1] - connections[i][4]);
            let zd = (connections[i][2] - connections[i][5]);
            tempRotation.setFromUnitVectors(yVec, tempVec2.set(xd, yd, zd).normalize());

            scale.y = tempVec2.set(xd, yd, zd).length();
    
            this.latticeCylinders.setMatrixAt( i, tempMat.compose( tempVec.set(x, y, z ), tempRotation, scale));
        }
    }

    /** Update the simulation */
    update() {
        // Render the scene and update the framerate counter
        this.world.controls.update();
        this.world.renderer.render(this.world.scene, this.world.camera);
        this.world.stats.update();
    }

    // Log Errors as <div>s over the main viewport
    fakeError(...args) {
        if (args.length > 0 && args[0]) { this.display(JSON.stringify(args[0])); }
        window.realConsoleError.apply(console, arguments);
    }

    display(text) {
        let errorNode = window.document.createElement("div");
        errorNode.innerHTML = text.fontcolor("red");
        window.document.getElementById("info").appendChild(errorNode);
    }
    
    /** Allows transferring to worker; CANNOT SERIALIZE BVH!!!
     *  Recommend Transferring and Building once
     * @param {THREE.Mesh} mesh */
    serializeMesh(mesh) {
        let serializedMesh = {
            name    : mesh.name,
            vertices: mesh.geometry.getAttribute("position").array
        };
        if (mesh.geometry.getIndex()) { serializedMesh.indices = mesh.geometry.getIndex().array; }
        if (mesh.geometry.getAttribute("normal")) { serializedMesh.normals = mesh.geometry.getAttribute("normal").array; }
        return serializedMesh;
    }
}

var main = new Main();

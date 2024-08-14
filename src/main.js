import * as THREE from '../node_modules/three/build/three.module.js';
import { GUI } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import World from './World.js';
import { Worker } from "./worker-with-import-map.js";
import { SegmentAccelerator } from "./SegmentAccelerator.js";

import { OBJLoader } from '../node_modules/three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from '../node_modules/three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from '../node_modules/three/examples/jsm/loaders/STLLoader.js';
import { USDZLoader } from '../node_modules/three/examples/jsm/loaders/USDZLoader.js';


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
            //loadMesh: this.loadMesh.bind(this),
            showMesh: true,
            voronoiMode: 0,
            numPoints: 500,
            showPoints: false,
            latticeMode: 0,
            exportPointCloudPLY: await this.exportPointCloudPLY.bind(this),
            exportEdgesPLY: this.exportEdgesPLY.bind(this)
        };
        this.gui = new GUI();
        //this.gui.add(this.latticeParams, 'loadMesh' ).name( 'Load Mesh' );
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
        this.gui.add(this.latticeParams, 'exportPointCloudPLY' ).name( 'Export Pointcloud to Mesh' );
        this.gui.add(this.latticeParams, 'exportEdgesPLY' ).name( 'Export Lattice Edges' );
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
        this.worker = new Worker("./assets/worker.js", { type: "module" });
        this.worker.onmessage = async (e) => {
            if(e.data.type === "Initialized") {
                console.log("Worker is ready!");
                this.worker.postMessage({ type: "Debug", data: "Helloooooooo!" });
                this.loadFile('armadillo.obj', './assets/armadillo.obj'); // Now that the worker is ready, we can load the initial mesh...
            }else if(e.data.type === "Progress") {
                await this.updateProgress(e.data.message, e.data.progress, 1);
            } else {
                console.log("Message received from worker", e.data);
                // Find the matching promise and resolve it
                if (e.data.type in this.activePromises) {
                    this.activePromises[e.data.type].resolve(e.data.result);
                    delete this.activePromises[e.data.type];
                }
            }
        };

        document.body.ondragover = (ev) => { ev.preventDefault(); };
        document.body.ondrop = this.dropHandler.bind(this);

        // Construct the render world
        this.world = new World(this);
    }

    async dropHandler(ev) {
        ev.preventDefault();
        for(let i = 0; i < ev.dataTransfer.items.length; i++){
        let item = ev.dataTransfer.items[i];
            if (item.kind === "file") {
                /** @type {File} */
                let file = item.getAsFile();
                console.log(`… file[${i}].name = ${file.name}`, file);
                await this.loadFile(file.name, URL.createObjectURL(file));
            }
        }
    }

    async updateProgress(progressText, current, max){
        this.status.innerHTML = progressText + " - <progress value='" + current + "' max='"+max+"'></progress>";
        // Add a delay to allow the HTML to take effect
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    /** @param {File} file */
    async loadFile(fileName, fileURL) {
        let extension = fileName.toLowerCase().split('.').pop();

        /** @type {THREE.Loader} */
        let loader = null;
               if(extension ===  "obj")                          { loader = new  OBJLoader();
        } else if(extension === "gltf" || extension === ("glb")) { loader = new GLTFLoader();
        } else if(extension ===  "fbx")                          { loader = new  FBXLoader();
        } else if(extension ===  "stl")                          { loader = new  STLLoader();
        } else if(extension === "usdz")                          { loader = new USDZLoader(); }


        let result = await (loader.loadAsync(fileURL,
            (progressEvent) => { this.updateProgress("Loading "+extension+"...", progressEvent.loaded, progressEvent.total); }));

               if(extension ===  "obj")                          { result = result;
        } else if(extension === "gltf" || extension === ("glb")) { result = result.scene;
        } else if(extension ===  "fbx")                          { result = result.scene;
        } else if(extension ===  "stl")                          { result = result;
        } else if(extension === "usdz")                          { result = result.scene; }

        let found = false;
        let mesh = null;
        result.traverse((child) => {
            child.position  .set(0, 0, 0);
            child.quaternion.set(0, 0, 0, 1);
            child.scale     .set(1, 1, 1);
            if (child.isMesh && !found) {
              mesh = child;
              console.log("Found Mesh", mesh);
              mesh.position  .set(0, 0, 0);
              mesh.quaternion.set(0, 0, 0, 1);
              mesh.scale     .set(1, 1, 1);
              
              found = true;
            }
          });

        await this.setupMesh(mesh);
    }

    async exportEdgesPLY() {
        let vertexDict = {};
        let vertices   = [];
        let edges      = [];

        for(let i = 0; i < this.connections.length; i++){
            for(let j = 0; j < 2; j++){
                let x = this.connections[i][j*3];
                let y = this.connections[i][j*3+1];
                let z = this.connections[i][j*3+2];
                let key = x + " " + y + " " + z;
                if(!(key in vertexDict)){
                    vertexDict[key] = vertices.length;
                    vertices.push([
                        this.connections[i][j*3],
                        this.connections[i][j*3+1],
                        this.connections[i][j*3+2]]);
                }
            }

            edges.push([vertexDict[this.connections[i][0] + " " + this.connections[i][1] + " " + this.connections[i][2]],
                        vertexDict[this.connections[i][3] + " " + this.connections[i][4] + " " + this.connections[i][5]]]);
        }

        let header = `ply
format ascii 1.0
comment object: A single line
element vertex `+(vertices.length)+`
property float x
property float y
property float z
element edge `+(edges.length)+`                        
property int vertex1                  
property int vertex2                  
end_header
`;

        let vertexStrings = [];
        for(let i = 0; i < vertices.length; i++){
            vertexStrings.push(vertices[i][0] + " " + vertices[i][1] + " " + vertices[i][2]);
        }
        let edgeStrings = [];
        for(let i = 0; i < edges.length; i++){
            edgeStrings.push(edges[i][0] + " " + edges[i][1]);
        }

        let blob = new Blob([header + vertexStrings.join("\n") + "\n" + edgeStrings.join("\n")], { type: 'text/plain' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = url;
        a.download = "edgeCloud.ply";
        a.click();
        URL.revokeObjectURL(url);
    }

    // Cool but failed idea; need a new one
    /*async exportPointCloudPLY() {
        let header = `ply
format ascii 1.0
element vertex `+(this.connections.length * 16)+`
property float x
property float y
property float z
property float nx
property float ny
property float nz
end_header
`;

        let cloudPoints = [];
        let radius = 1.0;
        let start = new THREE.Vector3();
        let end = new THREE.Vector3();
        let tempCenter = new THREE.Vector3();
        let tempDir = new THREE.Vector3();
        let tempDir2 = new THREE.Vector3();

        for(let i = 0; i < this.connections.length; i++){
            start.set(this.connections[i][0], this.connections[i][1], this.connections[i][2]);
            end  .set(this.connections[i][3], this.connections[i][4], this.connections[i][5]);
            tempCenter.addVectors(start, end).multiplyScalar(0.5);
            tempDir   .subVectors(end, start).normalize();

            for(let j = 1; j <= 4; j++){
                tempCenter.lerpVectors(start, end, j * 0.2);

                tempDir2.set(-tempDir.y, tempDir.x, tempDir.z).normalize();
                cloudPoints.push(
                    "" + (tempCenter.x + (tempDir2.x * radius)) + " ", 
                    "" + (tempCenter.y + (tempDir2.y * radius)) + " ",
                    "" + (tempCenter.z + (tempDir2.z * radius)) + " ", 
                    "" + tempDir2.x + " " + tempDir2.y + " " + tempDir2.z + "\n");
    
                tempDir2.set(tempDir.y, -tempDir.x, tempDir.z).normalize();
                cloudPoints.push(
                    "" + (tempCenter.x + (tempDir2.x * radius)) + " ", 
                    "" + (tempCenter.y + (tempDir2.y * radius)) + " ",
                    "" + (tempCenter.z + (tempDir2.z * radius)) + " ", 
                    "" + tempDir2.x + " " + tempDir2.y + " " + tempDir2.z + "\n");
    
                tempDir2.set(tempDir.x, -tempDir.z, tempDir.y).normalize();
                cloudPoints.push(
                    "" + (tempCenter.x + (tempDir2.x * radius)) + " ", 
                    "" + (tempCenter.y + (tempDir2.y * radius)) + " ",
                    "" + (tempCenter.z + (tempDir2.z * radius)) + " ", 
                    "" + tempDir2.x + " " + tempDir2.y + " " + tempDir2.z + "\n");
    
                tempDir2.set(tempDir.x, tempDir.z, -tempDir.y).normalize();
                cloudPoints.push(
                    "" + (tempCenter.x + (tempDir2.x * radius)) + " ", 
                    "" + (tempCenter.y + (tempDir2.y * radius)) + " ",
                    "" + (tempCenter.z + (tempDir2.z * radius)) + " ", 
                    "" + tempDir2.x + " " + tempDir2.y + " " + tempDir2.z + "\n");
            }


        }

        let blob = new Blob([header + cloudPoints.join("")], { type: 'text/plain' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = url;
        a.download = "pointCloud.ply";
        a.click();
        URL.revokeObjectURL(url);
    }*/

    /** Create a Line Segment Acceleration Structure and Evaluate on a Grid */
    async exportPointCloudPLY() {
        let bbox = new THREE.Box3().setFromObject(this.mesh, true);
        let voxelRes = 100;
        console.log("About to build Accelerator...");
        let accelerator = new SegmentAccelerator(voxelRes, bbox.min, bbox.max);
        for(let i = 0; i < this.connections.length; i++){
            accelerator.addSegment(this.connections[i]);
            if(i % 3000 === 0){
                await this.updateProgress("Building Accelerator...", i, this.connections.length);
            }
        }

        // Acceleration Structure is built; now evaluate on a grid
        let numPoints    = 0;
        let cloudPoints  = [];
        let voxelCenter  = new THREE.Vector3();
        let surfacePoint = new THREE.Vector3();
        let normal       = new THREE.Vector3();
        for(let i = 0; i < voxelRes; i++){
            for(let j = 0; j < voxelRes; j++){
                for(let k = 0; k < voxelRes; k++){
                    accelerator.getVoxelCenter(i, j, k, voxelCenter);
                    let closestPoints = accelerator.getClosestPointsOnSegmentsToPoint(voxelCenter);

                    for(let l = 0; l < closestPoints.length; l++){
                        // Project the closest point onto the thickness of the segment
                        surfacePoint.set(closestPoints[l][0], closestPoints[l][1], closestPoints[l][2]);

                        normal.copy(surfacePoint).sub(voxelCenter).normalize();
                        surfacePoint.add(normal);

                        cloudPoints.push(
                            "" + surfacePoint.x + " ", 
                            "" + surfacePoint.y + " ",
                            "" + surfacePoint.z + " ",
                            "" + normal.x + " ", 
                            "" + normal.y + " ",
                            "" + normal.z + "\n");
                        numPoints++;
                    }

                    if(i * voxelRes * voxelRes + j * voxelRes + k % 3000 === 0){
                        await this.updateProgress("Evaluating Grid...", i * voxelRes * voxelRes + j * voxelRes + k, voxelRes * voxelRes * voxelRes);
                    }
                }
            }
        }

        let header = `ply
format ascii 1.0
element vertex `+(numPoints)+`
property float x
property float y
property float z
property float nx
property float ny
property float nz
end_header
`;

        let blob = new Blob([header + cloudPoints.join("")], { type: 'text/plain' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = url;
        a.download = "pointCloud.ply";
        a.click();
        URL.revokeObjectURL(url);
    }

    async setupMesh(mesh) {
        if(this.mesh            ){ this.world.scene.remove(this.mesh); this.mesh.geometry .dispose(); this.mesh.material .dispose(); this.world.scaleScene(1.0/this.sceneScale); }
        if(this.voronoiSpheres  ){ this.world.scene.remove(this.voronoiSpheres)  ; this.voronoiSpheres  .dispose(); }
        if(this.tetMesh         ){ this.world.scene.remove(this.tetMesh)         ; }
        if(this.voronoiGeo      ){ this.voronoiGeo.dispose(); }
        if(this.latticeCylinders){ this.world.scene.remove(this.latticeCylinders); this.latticeCylinders.dispose(); }
        if(this.line            ){ this.world.scene.remove(this.line)            ; this.line.geometry   .dispose(); }
    
        // STEP 0. Create the Mesh and place it in the scene
        this.mesh = mesh;
        //this.mesh.name = meshName;
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
        this.connections = await this.sendWorkerRequest("CreateVoronoiLattice"  , { mesh: this.mesh.name, points: points, mode: this.latticeParams.latticeMode });

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
            new THREE.MeshStandardMaterial( { color: 0x00ff00, roughness: 1, metalness: 0 } ), this.connections.length );
        this.latticeCylinders.castShadow    = true;
        this.latticeCylinders.receiveShadow = true;
        this.world.scene.add( this.latticeCylinders );

        // Set the cylimder positions and rotations according to the connection start/end points
        for(let i = 0; i < this.connections.length; i++){
            let x = (this.connections[i][0] + this.connections[i][3]) * 0.5;
            let y = (this.connections[i][1] + this.connections[i][4]) * 0.5;
            let z = (this.connections[i][2] + this.connections[i][5]) * 0.5;

            let xd = (this.connections[i][0] - this.connections[i][3]);
            let yd = (this.connections[i][1] - this.connections[i][4]);
            let zd = (this.connections[i][2] - this.connections[i][5]);
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

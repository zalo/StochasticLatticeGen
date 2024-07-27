import * as THREE from '../node_modules/three/build/three.module.js';
import { GUI } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import World from './World.js';
import { OBJLoader } from '../node_modules/three/examples/jsm/loaders/OBJLoader.js';
import { Voro3D } from '../node_modules/voro3d/dist2/index.js';

// Import the BVH Acceleration Structure and monkey-patch the Mesh class with it
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, MeshBVH, getTriangleHitPointInfo } from '../node_modules/three-mesh-bvh/build/index.module.js';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

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
        this.physicsScene = { softBodies: [] };
        this.deferredConstructor();
    }
    async deferredConstructor() {
        // Configure Settings
        this.meshingParams = {
            numPoints: 1000
        };
        this.gui = new GUI();
        this.gui.add(this.meshingParams, 'numPoints', 5, 10000, 1).onFinishChange((value) => {
            if(this.mesh){ this.generateLattice(this.mesh); }});
        //this.gui.add(this.meshingParams, 'TargetTriangles', 100, 5000, 100).onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});
        //this.gui.add(this.meshingParams, 'MaxTriangleEdgeLength').onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});
        //this.gui.add(this.meshingParams, 'MinTetVolume').onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});

        // Construct the render world
        this.world = new World(this);

        this.sphereGeo = new THREE.SphereGeometry(1.0, 8, 8);
        this.voronoiSpheres = new THREE.InstancedMesh( this.sphereGeo, new THREE.MeshStandardMaterial( { color: 0xff0000, roughness: 1, metalness: 0 } ), this.meshingParams.numPoints );
        this.voronoiSpheres.castShadow = true;
        this.voronoiSpheres.receiveShadow = true;
        this.voronoiSpheres.visible = false;
        this.world.scene.add( this.voronoiSpheres );

        //this.closestSpheres = new THREE.InstancedMesh( this.sphereGeo, new THREE.MeshStandardMaterial( { color: 0x00ffff, roughness: 1, metalness: 0 } ), this.meshingParams.numPoints );
        //this.closestSpheres.castShadow = true;
        //this.closestSpheres.receiveShadow = true;
        //this.closestSpheres.visible = false;
        //this.world.scene.add( this.closestSpheres );

        // load a resource
        new OBJLoader().load( './assets/armadillo.obj',
            ( object ) => { this.generateLattice(object.children[0]); },
            ( xhr    ) => { console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' ); },
            ( error  ) => { console.log( 'A loading error happened', error );  }
        );
    }

    // Sample Points via Closest Point Queries
    checkIsInside(x, y, z, invWorld, tempVec, tempVec2, closestPointData, triangleData){
        tempVec.set(x, y, z).applyMatrix4(invWorld);                                                                   // Transform to local space
        this.bvh.closestPointToPoint(tempVec, closestPointData);                                                       // Find the closest point on the mesh
        getTriangleHitPointInfo(closestPointData.point, this.mesh.geometry, closestPointData.faceIndex, triangleData); // Get triangle normal
        return triangleData.face.normal.dot(tempVec2.copy(closestPointData.point).sub(tempVec)) > 0;                   // Check if point is inside the mesh
    }

    generateLattice(mesh){
        if(this.mesh){
            this.world.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.world.scene.remove(this.tetMesh);
            //this.tetMesh.geometry.dispose();
            //this.tetMesh.material.dispose();
        }

        /** @type {THREE.Mesh} */
        this.mesh = mesh;

        this.mesh.material = new THREE.MeshPhysicalMaterial({ color: 0xf78a1d, transparent: true, opacity: 0.5, side: THREE.FrontSide });
        this.mesh.geometry.computeVertexNormals();
        this.centerMesh(this.mesh);
        this.world.scene.add( this.mesh ); 
        let index = this.mesh.geometry.getIndex();
        if(index == null){
            index = new THREE.BufferAttribute(new Uint32Array(this.mesh.geometry.getAttribute("position").array.length / 3), 1);
            for(let i = 0; i < index.count; i++){ index.array[i] = i; }
        }

        console.log("Triggered builds of BVH!");
        /** @type {MeshBVH} */
        this.bvh = this.mesh.geometry.computeBoundsTree(); 

        let tempMat = new THREE.Matrix4();
        this.tempVec = new THREE.Vector3();
        this.tempVec2 = new THREE.Vector3();
        this.tempVec3 = new THREE.Vector3(1,1,1);
        let zeroRotation = new THREE.Quaternion();
        let sscale = new THREE.Vector3( 1, 1, 1 ).multiplyScalar(0.005);
        let bscale = new THREE.Vector3( 1, 1, 1 ).multiplyScalar(0.02);
        let bbox = new THREE.Box3().setFromObject(this.mesh, true);
        let boxSize = bbox.getSize(new THREE.Vector3());
        let boxMinCorner = bbox.min;
        let boxMaxCorner = bbox.max;
        let boxCenter = new THREE.Vector3(); bbox.getCenter(boxCenter);
        let raycaster = new THREE.Raycaster();
        let invWorld = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert();
        this.closestPointData = {}; this.triangleData = {};

        let points = [];// closestPoints = [];
        for(let i = 0; i < this.meshingParams.numPoints; i++){
            let x = (Math.random() * boxSize.x) - (boxSize.x * 0.5); 
            let y = (Math.random() * boxSize.y) - (boxSize.y * 0.5); 
            let z = (Math.random() * boxSize.z) - (boxSize.z * 0.5); 
            x += boxCenter.x; y += boxCenter.y; z += boxCenter.z;

            // Sample points via Raycasting
            //raycaster.set(tempVec.set(x, y, z), tempVec3.set(1,1,1));
            //this.mesh.material.side = THREE.DoubleSide;
            //let intersects = raycaster.intersectObject(this.mesh);
            //this.mesh.material.side = THREE.FrontSide;
            //if( intersects.length %2 === 1) { // Points is in object
            //    points.push(x); points.push(y); points.push(z);
            //    this.voronoiSpheres.setMatrixAt( i, tempMat.compose( tempVec.set(x, y, z ), zeroRotation, scale));
            //}else{
            //    i--; // Point is outside, reject this sample and try again
            //}

            let isInside = this.checkIsInside(x, y, z, invWorld, this.tempVec, this.tempVec2, this.closestPointData, this.triangleData);

            if(isInside) { // Points is in object
                this.closestPointData.point.applyMatrix4(this.mesh.matrixWorld);
                //console.log(isInside, distance, closestPointData.point, triangleData);
                points.push(x); points.push(y); points.push(z);
                //closestPoints.push((closestPointData.point.x - x)+closestPointData.point.x);
                //closestPoints.push((closestPointData.point.y - x)+closestPointData.point.y);
                //closestPoints.push((closestPointData.point.z - x)+closestPointData.point.z);
                this.voronoiSpheres.setMatrixAt( i, tempMat.compose( this.tempVec.set(x, y, z), zeroRotation, (isInside ? bscale : sscale)));
                //this.closestSpheres.setMatrixAt( i, tempMat.compose( this.tempVec.copy(closestPointData.point), zeroRotation, (isInside ? sscale : sscale)));
            }else{
                i--; // Point is outside, reject this sample and try again
            }
        }
        //points = points.concat(closestPoints);
        this.voronoiSpheres.instanceMatrix.needsUpdate = true;
        this.voronoiSpheres.visible = true;
        //this.closestSpheres.instanceMatrix.needsUpdate = true;
        //this.closestSpheres.visible = true;

        Voro3D.create(boxMinCorner.x * 1, boxMaxCorner.x* 1, 1 *boxMinCorner.y+0.0001, boxMaxCorner.y* 1, boxMinCorner.z* 1, boxMaxCorner.z* 1, 3, 3, 3).then((voro) => {
            this.voro = voro;
            let cells = this.voro.computeCells(points, true);
            //cells.sort((a, b) => { return a.particleID - b.particleID; });
            //console.log(cells);

            // Accumulate the connections
            let connectionsDict = {};
            for(let i = 0; i < cells.length; i++){
                let cell = cells[i];
                for(let j = 0; j < cells[i].neighbors.length; j++){
                    let neighbor = cell.neighbors[j];
                    if (neighbor > i) {
                        let sum = (cell.particleID * 10000) + cells[neighbor].particleID;
                        if (!(sum in connectionsDict)) {
                            connectionsDict[sum] = [cell.x, cell.y, cell.z, cells[neighbor].x, cells[neighbor].y, cells[neighbor].z];
                        }
                    }
                }
            }

            // Prune Exterior Connections
            for(let key in connectionsDict){
                let x = (connectionsDict[key][0] + connectionsDict[key][3]) * 0.5;
                let y = (connectionsDict[key][1] + connectionsDict[key][4]) * 0.5;
                let z = (connectionsDict[key][2] + connectionsDict[key][5]) * 0.5;
                if(!this.checkIsInside(x, y, z, invWorld, this.tempVec, this.tempVec2, this.closestPointData, this.triangleData)){
                    delete connectionsDict[key];
                }
            }

            let connections = Object.keys(connectionsDict).map((key) => { return connectionsDict[key]; });

            //console.log(connections);

            let tempMat = new THREE.Matrix4();
            let tempVec = new THREE.Vector3();
            let tempVec2 = new THREE.Vector3();
            let tempRotation = new THREE.Quaternion();
            let yVec = new THREE.Vector3(0, 1, 0);
            let scale = new THREE.Vector3( 1.0, 1, 1.0 ).multiplyScalar(0.005);
            let cylinderGeo = new THREE.CylinderGeometry( 1, 1, 1, 8 );
            this.latticeSpheres = new THREE.InstancedMesh( cylinderGeo, new THREE.MeshStandardMaterial( { color: 0x00ff00, roughness: 1, metalness: 0 } ), connections.length );
            this.latticeSpheres.castShadow = true;
            this.latticeSpheres.receiveShadow = true;
            this.world.scene.add( this.latticeSpheres );

            for(let i = 0; i < connections.length; i++){
                let x = (connections[i][0] + connections[i][3]) * 0.5;
                let y = (connections[i][1] + connections[i][4]) * 0.5;
                let z = (connections[i][2] + connections[i][5]) * 0.5;

                let xd = (connections[i][0] - connections[i][3]);
                let yd = (connections[i][1] - connections[i][4]);
                let zd = (connections[i][2] - connections[i][5]);
                tempRotation.setFromUnitVectors(yVec, tempVec2.set(xd, yd, zd).normalize());

                scale.y = tempVec2.set(xd, yd, zd).length();
    
                this.latticeSpheres.setMatrixAt( i, tempMat.compose( tempVec.set(x, y, z ), tempRotation, scale));
            }
        });
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

    /** @param {THREE.Mesh} mesh */
    centerMesh(mesh){
        let bbox = new THREE.Box3().setFromObject(mesh);
        let magnitude = bbox.getSize(new THREE.Vector3()).length();
        mesh.scale.divideScalar(magnitude / 2.5);
        bbox = new THREE.Box3().setFromObject(mesh);
        let center = new THREE.Vector3();
        bbox.getCenter(center);
        mesh.position.sub(center);
        bbox = new THREE.Box3().setFromObject(mesh);
        mesh.position.y -= bbox.min.y;
    }
}

var main = new Main();

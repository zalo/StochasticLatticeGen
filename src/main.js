import * as THREE from '../node_modules/three/build/three.module.js';
import { GUI } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import World from './World.js';
import { OBJLoader } from '../node_modules/three/examples/jsm/loaders/OBJLoader.js';
import { Voro3D } from '../node_modules/voro3d/dist/index.js';

// Import the BVH Acceleration Structure and monkey-patch the Mesh class with it
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from '../node_modules/three-mesh-bvh/build/index.module.js';
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

        this.sphereGeo = new THREE.SphereGeometry(1.0, 32, 32);
        this.voronoiSpheres = new THREE.InstancedMesh( this.sphereGeo, new THREE.MeshStandardMaterial( { color: 0xff0000, roughness: 1, metalness: 0 } ), this.meshingParams.numPoints );
        this.voronoiSpheres.castShadow = true;
        this.voronoiSpheres.receiveShadow = true;
        this.voronoiSpheres.visible = false;
        this.world.scene.add( this.voronoiSpheres );

        // load a resource
        new OBJLoader().load( './assets/armadillo.obj',
            ( object ) => { this.generateLattice(object.children[0]); },
            ( xhr    ) => { console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' ); },
            ( error  ) => { console.log( 'A loading error happened', error );  }
        );
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

        this.mesh = mesh;

        this.mesh.material = new THREE.MeshPhysicalMaterial({ color: 0xf78a1d, transparent: true, opacity: 0.5, side: THREE.FrontSide });
        this.centerMesh(this.mesh);
        this.world.scene.add( this.mesh ); 
        let index = this.mesh.geometry.getIndex();
        if(index == null){
            index = new THREE.BufferAttribute(new Uint32Array(this.mesh.geometry.getAttribute("position").array.length / 3), 1);
            for(let i = 0; i < index.count; i++){ index.array[i] = i; }
        }
        this.mesh.geometry.computeBoundsTree(); console.log("Triggered builds of BVH!");

        let tempMat = new THREE.Matrix4();
        let tempVec = new THREE.Vector3();
        let tempVec2 = new THREE.Vector3();
        let tempVec3 = new THREE.Vector3(1,1,1);
        let zeroRotation = new THREE.Quaternion();
        let scale = new THREE.Vector3( 1, 1, 1 ).multiplyScalar(0.01);
        let bbox = new THREE.Box3().setFromObject(this.mesh, true);
        let boxSize = bbox.getSize(tempVec2);
        let boxMinCorner = bbox.min;
        let boxMaxCorner = bbox.max;
        let boxCenter = new THREE.Vector3(); bbox.getCenter(boxCenter);
        let raycaster = new THREE.Raycaster()

        let points = [];
        for(let i = 0; i < this.meshingParams.numPoints; i++){
            let x = (Math.random() * boxSize.x) - (boxSize.x * 0.5); 
            let y = (Math.random() * boxSize.y) - (boxSize.y * 0.5); 
            let z = (Math.random() * boxSize.z) - (boxSize.z * 0.5); 

            x += boxCenter.x; y += boxCenter.y; z += boxCenter.z;
            raycaster.set(tempVec.set(x, y, z), tempVec3);

            this.mesh.material.side = THREE.DoubleSide;
            let intersects = raycaster.intersectObject(this.mesh);
            this.mesh.material.side = THREE.FrontSide;

            if( intersects.length %2 === 1) { // Points is in object
                points.push(x); points.push(y); points.push(z);
                this.voronoiSpheres.setMatrixAt( i, tempMat.compose( tempVec.set(x, y, z ), zeroRotation, scale));
            }else{
                i--; // Point is outside, reject this sample and try again
            }
            this.voronoiSpheres.instanceMatrix.needsUpdate = true;
            this.voronoiSpheres.visible = true;
        }

        Voro3D.create(boxMinCorner.x * 1, boxMaxCorner.x* 1, 1 *boxMinCorner.y+0.0001, boxMaxCorner.y* 1, boxMinCorner.z* 1, boxMaxCorner.z* 1, 1, 1, 1).then((voro) => {
            this.voro = voro;
            let cells = this.voro.computeCells(points, true);
            //console.log(cells);

            // Accumulate the connections
            let connectionsDict = {};
            for(let i = 0; i < cells.length; i++){
                let cell = cells[i];
                for(let j = 0; j < cells[i].nFaces; j++){
                    let face = cell.faces[j];
                    for(let k = 0; k < face.length; k++){
                        let indexA = face[k];
                        let indexB = face[(k+1)%face.length];

                        let aVertexX = cells[i].vertices[indexA*3  ];
                        let aVertexY = cells[i].vertices[indexA*3+1];
                        let aVertexZ = cells[i].vertices[indexA*3+2];

                        let bVertexX = cells[i].vertices[indexB*3  ];
                        let bVertexY = cells[i].vertices[indexB*3+1];
                        let bVertexZ = cells[i].vertices[indexB*3+2];

                        let sumA     = aVertexX + aVertexY + aVertexZ;
                        let sumB     = bVertexX + bVertexY + bVertexZ;
                        let sum      = sumA + sumB;

                        if (!(sum in connectionsDict)) {
                            if(sumA < sumB){
                                connectionsDict[sum] = [aVertexX, aVertexY, aVertexZ, bVertexX, bVertexY, bVertexZ];
                            }else{
                                connectionsDict[sum] = [bVertexX, bVertexY, bVertexZ, aVertexX, aVertexY, aVertexZ];
                            }
                        }
                    }
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

import * as THREE from '../node_modules/three/build/three.module.js';
import { GUI } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import World from './World.js';
import { OBJLoader } from '../node_modules/three/examples/jsm/loaders/OBJLoader.js';
import { Voro3D } from '../assets/voro3d/dist/index.js';
import { MeshSurfaceSampler } from '../node_modules/three/examples/jsm/math/MeshSurfaceSampler.js';

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
            voronoiMode: 0,
            numPoints: 500
        };
        this.gui = new GUI();
        this.gui.add( this.latticeParams, 'loadMesh' ).name( 'Load Mesh' )
        this.gui.add( this.latticeParams, 'voronoiMode', { Surface: 0, Volume: 1 } ).name( 'Sampling Mode' );
        this.gui.add(this.latticeParams, 'numPoints', 5, 10000, 1).name( 'Num Points' ).onFinishChange((value) => {
            if(this.mesh){ this.generateLattice(this.mesh); }});
        //this.gui.add(this.meshingParams, 'TargetTriangles', 100, 5000, 100).onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});
        //this.gui.add(this.meshingParams, 'MaxTriangleEdgeLength').onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});
        //this.gui.add(this.meshingParams, 'MinTetVolume').onFinishChange((value) => {
        //    if(this.mesh){ this.generateTetMesh(this.mesh); }});

        this.sphereGeo = new THREE.SphereGeometry(1.0, 32, 32);
        this.cylinderGeo = new THREE.CylinderGeometry( 1, 1, 1, 8 );

        // Construct the render world
        this.world = new World(this);

        this.loadMesh(this.mesh);
    }

    loadMesh(mesh){
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
            this.world.scene.remove(this.tetMesh);
            this.world.scene.remove(this.voronoiSpheres);
            this.world.scene.remove(this.latticeCylinders);
            this.world.scene.remove(this.line);

            this.mesh.geometry .dispose();
            this.mesh.material .dispose();
            this.voronoiSpheres.dispose();
            this.latticeCylinders.dispose();
            this.voronoiGeo.dispose();
            this.line.geometry.dispose();

            this.world.scaleScene(1.0/this.sceneScale);

            //this.tetMesh.geometry.dispose();
            //this.tetMesh.material.dispose();
        }

        // STEP 0. Create the Mesh and place it in the scene
        this.mesh = mesh;
        this.mesh.material = new THREE.MeshPhysicalMaterial({ color: 0xf78a1d, transparent: true, opacity: 0.5, side: THREE.FrontSide });
        this.world.scene.add( this.mesh );
        let index = this.mesh.geometry.getIndex();
        if(index == null){ // Add triangle indexing if it does not exist
            index = new THREE.BufferAttribute(new Uint32Array(this.mesh.geometry.getAttribute("position").array.length / 3), 1);
            for(let i = 0; i < index.count; i++){ index.array[i] = i; }
        }
        this.mesh.geometry.computeBoundsTree( { maxLeafTris: 1, strategy: SAH } ); console.log("Triggered builds of BVH!");

        // STEP 1. Sample a uniform distribution of points on the surface or within the volume of the mesh

        this.voronoiSpheres = new THREE.InstancedMesh( this.sphereGeo, new THREE.MeshStandardMaterial( { color: 0xff0000, roughness: 1, metalness: 0 } ), this.latticeParams.numPoints );
        this.voronoiSpheres.castShadow = true;
        this.voronoiSpheres.receiveShadow = true;
        this.voronoiSpheres.visible = false;
        this.world.scene.add( this.voronoiSpheres );

        let tempMat = new THREE.Matrix4();
        let tempVec = new THREE.Vector3();
        let tempVec2 = new THREE.Vector3();
        let tempVec3 = new THREE.Vector3(1,1,1);
        let zeroRotation = new THREE.Quaternion();
        let bbox = new THREE.Box3().setFromObject(this.mesh, true);
        this.sceneScale = bbox.getSize(tempVec2).length() / 3.0;
        this.world.scaleScene(this.sceneScale);
        let scale = new THREE.Vector3( 1, 1, 1 ).multiplyScalar(0.004 * this.sceneScale);
        let boxSize = bbox.getSize(tempVec2);
        let boxMinCorner = bbox.min;
        let boxMaxCorner = bbox.max;
        let boxCenter = new THREE.Vector3(); bbox.getCenter(boxCenter);
        let raycaster = new THREE.Raycaster()

        // Create a sampler for the Mesh surface (to use if we're sampling surface points)
        let surfaceSampler = new MeshSurfaceSampler( this.mesh ).build();

        let points = [];
        for(let i = 0; i < this.latticeParams.numPoints; i++){

            // Voronoi Mode 0: Sample on the surface
            if(this.latticeParams.voronoiMode === 0){
                surfaceSampler.sample(tempVec);
                points.push(tempVec.x); points.push(tempVec.y); points.push(tempVec.z);
                this.voronoiSpheres.setMatrixAt(i, tempMat.compose(tempVec, zeroRotation, scale));
            // Voronoi Mode 1: Sample within the volume
            // Uses rejection sampling to ensure points are within the mesh; pretty slow
            } else if(this.latticeParams.voronoiMode === 1) {
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
            }
        }
        this.voronoiSpheres.instanceMatrix.needsUpdate = true;
        this.voronoiSpheres.visible = true;

        Voro3D.create(boxMinCorner.x * 1, boxMaxCorner.x* 1, 1 *boxMinCorner.y+0.0001, boxMaxCorner.y* 1, boxMinCorner.z* 1, boxMaxCorner.z* 1, 1, 1, 1).then((voro) => {
            this.voro = voro;
            let cells = this.voro.computeCells(points, true);
            //console.log(cells);

            let voronoiMeshVertices = [];
            let voronoiMeshIndices  = [];
            let voronoiMeshNormals  = [];
            let curIdx = 0; 

            // Accumulate the faces
            let facesDict = {};
            for(let i = 0; i < cells.length; i++){
                let cell = cells[i];
                for(let j = 0; j < cells[i].nFaces; j++){
                    let face = cell.faces[j];

                    let faceKey = Math.max(cells[i].particleID, cells[i].neighbors[j]) + "-" + Math.min(cells[i].particleID, cells[i].neighbors[j]);

                    let dir1 = new THREE.Vector3().fromArray(cells[i].vertices[face[1]*3  ] - cells[i].vertices[face[0]*3  ],
                                                             cells[i].vertices[face[1]*3+1] - cells[i].vertices[face[0]*3+1],
                                                             cells[i].vertices[face[1]*3+2] - cells[i].vertices[face[0]*3+2]);
                    let dir2 = new THREE.Vector3().fromArray(cells[i].vertices[face[2]*3  ] - cells[i].vertices[face[0]*3  ],
                                                             cells[i].vertices[face[2]*3+1] - cells[i].vertices[face[0]*3+1],
                                                             cells[i].vertices[face[2]*3+2] - cells[i].vertices[face[0]*3+2]);
                    let normal = new THREE.Vector3().crossVectors(dir1, dir2).normalize();

                    if (!(faceKey in facesDict)) {
                        facesDict[faceKey] = curIdx;
                        // Push the vertices
                        for(let k = 0; k < face.length; k++){
                            voronoiMeshVertices.push(cells[i].vertices[face[k]*3  ]);
                            voronoiMeshVertices.push(cells[i].vertices[face[k]*3+1]);
                            voronoiMeshVertices.push(cells[i].vertices[face[k]*3+2]);
                            voronoiMeshNormals.push(normal.x);
                            voronoiMeshNormals.push(normal.y);
                            voronoiMeshNormals.push(normal.z);
                        }

                        // Push the vertex fan indices
                        for(let k = 1; k < face.length - 1; k++){
                            voronoiMeshIndices.push(curIdx);
                            voronoiMeshIndices.push(curIdx + k);
                            voronoiMeshIndices.push(curIdx + k + 1);
                        }
                        curIdx += face.length;
                    }
                }
            }

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

            this.voronoiGeo = new THREE.BufferGeometry();
            this.voronoiGeo.setAttribute('position', new THREE.Float32BufferAttribute(voronoiMeshVertices, 3));
            this.voronoiGeo.setAttribute('normal', new THREE.Float32BufferAttribute(voronoiMeshNormals, 3));
            this.voronoiGeo.setIndex(voronoiMeshIndices);
            this.tetMesh = new THREE.Mesh(this.voronoiGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
            this.voronoiGeo.computeBoundsTree( { maxLeafTris: 1, strategy: SAH } );
            this.computeIntersectionContours(this.mesh, this.tetMesh);

            let connections = Object.keys(connectionsDict).map((key) => { return connectionsDict[key]; });

            // Prune connections based on insidedness
            let prunedConnections = [];
            //tempVec = new THREE.Vector3();
            //tempVec2 = new THREE.Vector3();
            //tempVec3 = new THREE.Vector3(1,1,1);
            for(let i = 0; i < connections.length; i++){
                let x = (connections[i][0]);
                let y = (connections[i][1]);
                let z = (connections[i][2]);

                let xd = (connections[i][3] - connections[i][0]);
                let yd = (connections[i][4] - connections[i][1]);
                let zd = (connections[i][5] - connections[i][2]);
                let maxDist = Math.sqrt(xd*xd + yd*yd + zd*zd);
                raycaster.set(new THREE.Vector3(x, y, z), new THREE.Vector3(xd, yd, zd).normalize());

                this.mesh.material.side = THREE.DoubleSide;
                let intersects = raycaster.intersectObject(this.mesh);
                this.mesh.material.side = THREE.FrontSide;

                let startsInside = intersects.length %2 === 1;
                //let endsInside = intersects[intersects.length - 1].distance < maxDist;

                let curOrigin = new THREE.Vector3(x, y, z);
                for(let j = 0; j < intersects.length; j++){
                    if (intersects[j].distance >= maxDist) { 
                        if ((startsInside && j % 2 === 0) || (!startsInside && j % 2 !== 0)) {
                            prunedConnections.push([curOrigin.x, curOrigin.y, curOrigin.z, connections[i][3], connections[i][4], connections[i][5]]);
                        }
                        break; 
                    } else{
                        if ((startsInside && j % 2 === 0) || (!startsInside && j % 2 !== 0)) {
                            prunedConnections.push([curOrigin.x, curOrigin.y, curOrigin.z, intersects[j].point.x, intersects[j].point.y, intersects[j].point.z]);
                        }
                    }

                    curOrigin.copy(intersects[j].point);
                    
                }
            }
            connections = prunedConnections;


            // Add Intersection Contours to the Connections
            for(let i = 0; i < this.line.geometry.attributes.position.array.length; i+=6){
                connections.push([this.line.geometry.attributes.position.array[i],
                                  this.line.geometry.attributes.position.array[i+1],
                                  this.line.geometry.attributes.position.array[i+2],
                                  this.line.geometry.attributes.position.array[i+3],
                                  this.line.geometry.attributes.position.array[i+4],
                                  this.line.geometry.attributes.position.array[i+5]]);
            }

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
        });
    }

    computeIntersectionContours(mesh1, mesh2){
        let lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setFromPoints( [ new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 0, - 1, 0 ) ] );
        this.line = new THREE.LineSegments( lineGeometry, new THREE.LineBasicMaterial( { color: 0x00FF00 } ) );
        //this.world.scene.add( this.line );

        this.world.scene.updateMatrixWorld( true );

        let matrix2to1 = new THREE.Matrix4()
            .copy( mesh1.matrixWorld )
            .invert()
            .multiply( mesh2.matrixWorld );
    
        let edge = new THREE.Line3();
        let results = [];
        mesh1.geometry.boundsTree.bvhcast( mesh2.geometry.boundsTree, matrix2to1, {
            intersectsTriangles( triangle1, triangle2 ) {
                if ( triangle1.intersectsTriangle( triangle2, edge ) ) {
                    let { start, end } = edge;
                    results.push(start.x, start.y, start.z,
                                   end.x,   end.y,   end.z);
                }
            }
        } );
    
        if ( results.length ) {
            let geometry = this.line.geometry;
            let posArray = geometry.attributes.position.array;
            if ( posArray.length < results.length ) {
                geometry.dispose();
                geometry.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( results ), 3, false ) );
            } else {
                posArray.set( results );
            }
    
            geometry.setDrawRange( 0, results.length / 3 );
            geometry.attributes.position.needsUpdate = true;
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

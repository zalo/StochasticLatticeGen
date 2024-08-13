import * as THREE from '../node_modules/three/build/three.module.js';
import { Voro3D } from './voro3d/dist/index.js';
import { MeshSurfaceSampler } from '../node_modules/three/examples/jsm/math/MeshSurfaceSampler.js';

// Import the BVH Acceleration Structure and monkey-patch the Mesh class with it
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, SAH } from '../node_modules/three-mesh-bvh/build/index.module.js';
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

var namesToMeshes = {}, voro = null, line = null, sceneScale = 1.0, boxMinCorner, boxMaxCorner;
async function storeMesh (data) {
    console.log("Storing Mesh", data);

    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
    if("normal" in data) { 
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3)); 
    } else{
        geometry.computeVertexNormals();
    }
    if("index" in data) {
        geometry.setIndex(data.index);
    }else{
        let index = new THREE.BufferAttribute(new Uint32Array(data.vertices.length / 3), 1);
        for(let i = 0; i < index.count; i++){ index.array[i] = i; }
        geometry.setIndex(data.index);
    }
    let mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    geometry.computeBoundsTree( { maxLeafTris: 1, strategy: SAH } );
    mesh.name = data.name;
    new THREE.Scene().add(mesh);
    namesToMeshes[data.name] = mesh;

    console.log("Mesh Stored!", mesh);

    let tempVec2 = new THREE.Vector3();
    let bbox = new THREE.Box3().setFromObject(mesh, true);
    sceneScale = bbox.getSize(tempVec2).length() / 3.0;
    boxMinCorner = bbox.min;
    boxMaxCorner = bbox.max;

    let blockingInitialization = new Promise((resolve, reject) => {
        // Create a new voronoi volume around the mesh
        Voro3D.create(
            boxMinCorner.x, 
            boxMaxCorner.x, 
            boxMinCorner.y + 0.00000001,
            boxMaxCorner.y, 
            boxMinCorner.z, 
            boxMaxCorner.z, 
            3, 3, 3).then((newVoro) => { voro = newVoro; resolve(true); });
    });
    return await blockingInitialization;
}

async function samplePointsOnMesh (data) {
    let tempVec        = new THREE.Vector3();
    // Create a sampler for the Mesh surface
    let surfaceSampler = new MeshSurfaceSampler( namesToMeshes[data.mesh] ).build();

    let points = [];
    for(let i = 0; i < data.numPoints; i++){
        surfaceSampler.sample(tempVec);
        points.push(tempVec.x); 
        points.push(tempVec.y); 
        points.push(tempVec.z);

        if(i % 1500 === 0) {
            postMessage( { "type": "Progress", "message": "Sampling Points: " + (i+1) + " / " + data.numPoints, "progress": (i+1) / data.numPoints });
        }
    }
    postMessage( { "type": "Progress", "message": "Sampling Points: " + data.numPoints + " / " + data.numPoints, "progress": 1.0 });
    return points;
}

async function samplePointsInVolume (data) {
    let tempVec   = new THREE.Vector3();
    let tempVec2  = new THREE.Vector3();
    let tempVec3  = new THREE.Vector3(1,1,1);
    let bbox      = new THREE.Box3().setFromObject(namesToMeshes[data.mesh], true);
    let boxSize   = bbox.getSize(tempVec2);
    let boxCenter = new THREE.Vector3(); bbox.getCenter(boxCenter);
    let raycaster = new THREE.Raycaster()

    let points = [];
    for(let i = 0; i < data.numPoints; i++){
        let x = (Math.random() * boxSize.x) - (boxSize.x * 0.5); 
        let y = (Math.random() * boxSize.y) - (boxSize.y * 0.5); 
        let z = (Math.random() * boxSize.z) - (boxSize.z * 0.5); 

        x += boxCenter.x; y += boxCenter.y; z += boxCenter.z;
        raycaster.set(tempVec.set(x, y, z), tempVec3);

        namesToMeshes[data.mesh].material.side = THREE.DoubleSide;
        let intersects = raycaster.intersectObject(namesToMeshes[data.mesh]);
        namesToMeshes[data.mesh].material.side = THREE.FrontSide;

        if( intersects.length %2 === 1) { // Points is in object
            points.push(x); points.push(y); points.push(z);
        }else{
            i--; // Point is outside, reject this sample and try again
        }

        if(i % 1500 === 0) {
            postMessage( { "type": "Progress", "message": "Sampling Points: " + (i+1) + " / " + data.numPoints, "progress": (i+1) / data.numPoints });
        }
    }
    postMessage( { "type": "Progress", "message": "Sampling Points: " + data.numPoints + " / " + data.numPoints, "progress": 1.0 });
    return points;
}

async function createVoronoiLattice (data) {

    // STEP 2. Bake a Voronoi Lattice from the sampled points

    let tempVec   = new THREE.Vector3();
    let tempVec1  = new THREE.Vector3();
    let tempNorm  = new THREE.Vector3();
    let tempVec2  = new THREE.Vector3();
    let bbox      = new THREE.Box3().setFromObject(namesToMeshes[data.mesh], true);
    sceneScale    = bbox.getSize(tempVec2).length() / 3.0;
    let raycaster = new THREE.Raycaster()

    postMessage( { "type": "Progress", "message": "Computing Voronoi Cells...", "progress": -1.0 });
    let cells = voro.computeCells(data.points, true);
    //console.log(cells);

    let facesDict = {};
    let voronoiMeshVertices = [];
    let voronoiMeshIndices  = [];
    let voronoiMeshNormals  = [];
    if(data.mode <= 0){
        let curIdx = 0; 

        // Accumulate the faces
        for(let i = 0; i < cells.length; i++){
            let cell = cells[i];
            for(let j = 0; j < cells[i].nFaces; j++){
                let face = cell.faces[j];

                let faceKey = Math.max(cells[i].particleID, cells[i].neighbors[j]) + "-" + Math.min(cells[i].particleID, cells[i].neighbors[j]);

                let dir1   = tempVec.set (cells[i].vertices[face[1]*3  ] - cells[i].vertices[face[0]*3  ],
                                        cells[i].vertices[face[1]*3+1] - cells[i].vertices[face[0]*3+1],
                                        cells[i].vertices[face[1]*3+2] - cells[i].vertices[face[0]*3+2]);
                let dir2   = tempVec1.set(cells[i].vertices[face[2]*3  ] - cells[i].vertices[face[0]*3  ],
                                        cells[i].vertices[face[2]*3+1] - cells[i].vertices[face[0]*3+1],
                                        cells[i].vertices[face[2]*3+2] - cells[i].vertices[face[0]*3+2]);
                let normal = tempNorm.crossVectors(dir1, dir2).normalize();

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
            if(i % 500 === 0) {
                postMessage( { "type": "Progress", "message": "Triangulating Cell Faces: " + (i+1) + " / " + cells.length, "progress": (i+1) / cells.length });
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
        if(i % 500 === 0) {
            postMessage( { "type": "Progress", "message": "Enumerating Cell Connections: " + (i+1) + " / " + cells.length, "progress": (i+1) / cells.length });
        }
    }

    let connections = Object.keys(connectionsDict).map((key) => { return connectionsDict[key]; });

    if(data.mode <= 0){
        let voronoiGeo = new THREE.BufferGeometry();
        voronoiGeo.setAttribute('position', new THREE.Float32BufferAttribute(voronoiMeshVertices, 3));
        voronoiGeo.setAttribute('normal', new THREE.Float32BufferAttribute(voronoiMeshNormals, 3));
        voronoiGeo.setIndex(voronoiMeshIndices);
        let tetMesh = new THREE.Mesh(voronoiGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
        voronoiGeo.computeBoundsTree( { maxLeafTris: 1, strategy: SAH } );
        computeIntersectionContours(namesToMeshes[data.mesh], tetMesh);
    }

    if(data.mode >= 0 && data.mode !== 2){
        // Prune connections based on insidedness
        let prunedConnections = [];
        let curOrigin = new THREE.Vector3();
        for(let i = 0; i < connections.length; i++) {
            let x = (connections[i][0]);
            let y = (connections[i][1]);
            let z = (connections[i][2]);

            let xd = (connections[i][3] - connections[i][0]);
            let yd = (connections[i][4] - connections[i][1]);
            let zd = (connections[i][5] - connections[i][2]);
            let maxDist = Math.sqrt(xd*xd + yd*yd + zd*zd);
            raycaster.set(new THREE.Vector3(x, y, z), new THREE.Vector3(xd, yd, zd).normalize());

            namesToMeshes[data.mesh].material.side = THREE.DoubleSide;
            let intersects = raycaster.intersectObject(namesToMeshes[data.mesh]);
            namesToMeshes[data.mesh].material.side = THREE.FrontSide;

            let startsInside = intersects.length %2 === 1;
            //let endsInside = intersects[intersects.length - 1].distance < maxDist;

            curOrigin.set(x, y, z);
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
            if(i % 500 === 0) {
                postMessage( { "type": "Progress", "message": "Trimming Connections to Mesh: " + (i+1) + " / " + connections.length, "progress": (i+1) / connections.length });
            }
        }
        connections = prunedConnections;
    }

    if(data.mode <  0) { connections = []; }
    if(data.mode <= 0){
        // Add Intersection Contours to the Connections
        for(let i = 0; i < line.geometry.attributes.position.array.length; i+=6){
            connections.push([line.geometry.attributes.position.array[i],
                            line.geometry.attributes.position.array[i+1],
                            line.geometry.attributes.position.array[i+2],
                            line.geometry.attributes.position.array[i+3],
                            line.geometry.attributes.position.array[i+4],
                            line.geometry.attributes.position.array[i+5]]);
        }
    }

    // Reinitialize the Voronoi Computer
    voro = null;
    let blockingInitialization = new Promise((resolve, reject) => {
        // Create a new voronoi volume around the mesh
        Voro3D.create(
            boxMinCorner.x, 
            boxMaxCorner.x, 
            boxMinCorner.y + 0.00000001,
            boxMaxCorner.y, 
            boxMinCorner.z, 
            boxMaxCorner.z, 
            3, 3, 3).then((newVoro) => { voro = newVoro; resolve(true); });
    });
    await blockingInitialization;

    postMessage( { "type": "Progress", "message": "Lattice Complete!", "progress": 1.0 });
    return connections;
}

async function computeIntersectionContours (mesh1, mesh2) {
    let lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setFromPoints( [ new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 0, - 1, 0 ) ] );
    line = new THREE.LineSegments( lineGeometry, new THREE.LineBasicMaterial( { color: 0x00FF00 } ) );

    let tris1 = mesh1.geometry.getIndex().count / 3;
    let tris2 = mesh2.geometry.getIndex().count / 3;
    console.log("Num Triangles", tris1, tris2);
    let cur = 0;
    let total = Math.log(Math.max(tris1, tris2)) * Math.min(tris1, tris2); // I can't figure out how to get the actual number of intersections

    let edge = new THREE.Line3();
    let results = [];
    mesh1.geometry.boundsTree.bvhcast( mesh2.geometry.boundsTree, new THREE.Matrix4().identity(), {
        intersectsTriangles( triangle1, triangle2 ) {
            cur++;
            if ( triangle1.intersectsTriangle( triangle2, edge ) ) {
                let { start, end } = edge;
                results.push(start.x, start.y, start.z,
                               end.x,   end.y,   end.z);
            }

            if(cur % 5000 === 0) {
                postMessage( { "type": "Progress", "message": "Trimming Contours to Mesh: " + (cur+1), "progress": Math.random() }); // I give up!
            }
        }
    } );

    if ( results.length ) {
        let geometry = line.geometry;
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


/** Allows transferring to worker; CANNOT SERIALIZE BVH!!!
 *  Recommend Transferring and Building once
 * @param {THREE.Mesh} mesh */
async function serializeMesh(mesh) {
    let serializedMesh = {
        name    : mesh.name,
        vertices: mesh.geometry.getAttribute("position").array
    };
    if (mesh.geometry.getIndex()) { serializedMesh.indices = mesh.geometry.getIndex().array; }
    if (mesh.geometry.getAttribute("normal")) { serializedMesh.normals = mesh.geometry.getAttribute("normal").array; }
    return serializedMesh;
}

onmessage = async (e) => {
    let typeToFunction = {
        "StoreMesh"              : storeMesh,
        "SamplePointsOnMesh"     : samplePointsOnMesh,
        "SamplePointsInVolume"   : samplePointsInVolume,
        "CreateVoronoiLattice"   : createVoronoiLattice,
    }
    if(e.data.type in typeToFunction){
        postMessage({ "type": e.data.type, "result": await typeToFunction[e.data.type](e.data.data) });
    } else {
        postMessage({ "type": "Error", "result": "Unknown type: " + e.data.type, "data": e.data.data });
    }
};

postMessage( { "type": "Initialized" });
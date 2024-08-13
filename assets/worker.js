import * as THREE from '../node_modules/three/build/three.module.js';
import { Voro3D } from './voro3d/dist/index.js';
import { MeshSurfaceSampler } from '../node_modules/three/examples/jsm/math/MeshSurfaceSampler.js';

// Import the BVH Acceleration Structure and monkey-patch the Mesh class with it
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, SAH } from '../node_modules/three-mesh-bvh/build/index.module.js';
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

var namesToMeshes = {};
function storeMesh (data) {
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
    namesToMeshes[data.name] = mesh;

    console.log("Mesh Stored!", mesh);

    return true;
}

function samplePointsOnMesh (data) {
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

function samplePointsInVolume (data) {
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

function createVoronoiLattice (data) {

    let points = [];
    for(let i = 0; i < data.numPoints; i++){


        if(i % 1500 === 0) {
            postMessage( { "type": "Progress", "message": "Sampling Points: " + (i+1) + " / " + data.numPoints, "progress": (i+1) / data.numPoints });
        }
    }
    postMessage( { "type": "Progress", "message": "Sampling Points: " + data.numPoints + " / " + data.numPoints, "progress": 1.0 });
    return points;
}

/** Allows transferring to worker; CANNOT SERIALIZE BVH!!!
 *  Recommend Transferring and Building once
 * @param {THREE.Mesh} mesh */
function serializeMesh(mesh) {
    let serializedMesh = {
        name    : mesh.name,
        vertices: mesh.geometry.getAttribute("position").array
    };
    if (mesh.geometry.getIndex()) { serializedMesh.indices = mesh.geometry.getIndex().array; }
    if (mesh.geometry.getAttribute("normal")) { serializedMesh.normals = mesh.geometry.getAttribute("normal").array; }
    return serializedMesh;
}

onmessage = (e) => {
    let typeToFunction = {
        "StoreMesh"              : storeMesh,
        "SamplePointsOnMesh"     : samplePointsOnMesh,
        "SamplePointsInVolume"   : samplePointsInVolume,
        "CreateVoronoiLattice"   : createVoronoiLattice,
    }
    if(e.data.type in typeToFunction){
        postMessage({ "type": e.data.type, "result": typeToFunction[e.data.type](e.data.data) });
    } else {
        postMessage({ "type": "Error", "result": "Unknown type: " + e.data.type, "data": e.data.data });
    }
};

postMessage( { "type": "Initialized" });
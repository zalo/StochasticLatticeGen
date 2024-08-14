import * as THREE from '../node_modules/three/build/three.module.js';

export class SegmentAccelerator {
    constructor(voxelResolution, boxMin, boxMax) {
        this.voxelResolution = voxelResolution;
        this.boxMin = boxMin;
        this.boxMax = boxMax;

        // Initialize an empty voxel grid
        this.voxels = [];
        for(let i = 0; i < voxelResolution; i++) {
            this.voxels[i] = [];
            for(let j = 0; j < voxelResolution; j++) {
                this.voxels[i][j] = [];
                for(let k = 0; k < voxelResolution; k++) {
                    this.voxels[i][j][k] = [];
                }
            }
        }
    }

    // Add a segment to the voxel grid
    addSegment(segment) {
        let x1 = ((segment[0] - this.boxMin.x) / (this.boxMax.x - this.boxMin.x)) * this.voxelResolution;
        let y1 = ((segment[1] - this.boxMin.y) / (this.boxMax.y - this.boxMin.y)) * this.voxelResolution;
        let z1 = ((segment[2] - this.boxMin.z) / (this.boxMax.z - this.boxMin.z)) * this.voxelResolution;
        let x2 = ((segment[3] - this.boxMin.x) / (this.boxMax.x - this.boxMin.x)) * this.voxelResolution;
        let y2 = ((segment[4] - this.boxMin.y) / (this.boxMax.y - this.boxMin.y)) * this.voxelResolution;
        let z2 = ((segment[5] - this.boxMin.z) / (this.boxMax.z - this.boxMin.z)) * this.voxelResolution;

        // Bresenham's Algorithm to get all voxels on the segment
        let points = this.Bresenham3D(x1, y1, z1, x2, y2, z2);
        for(let i = 0; i < points.length; i++) {
            if (points[i][0] < 0 || points[i][0] >= this.voxelResolution) continue;
            if (points[i][1] < 0 || points[i][1] >= this.voxelResolution) continue;
            if (points[i][2] < 0 || points[i][2] >= this.voxelResolution) continue;
            this.voxels
                [points[i][0]]
                [points[i][1]]
                [points[i][2]].push(segment);
        }
    }

    getVoxelAtPoint(x, y, z) {
        let x1 = ((x - this.boxMin.x) / (this.boxMax.x - this.boxMin.x)) * this.voxelResolution;
        let y1 = ((y - this.boxMin.y) / (this.boxMax.y - this.boxMin.y)) * this.voxelResolution;
        let z1 = ((z - this.boxMin.z) / (this.boxMax.z - this.boxMin.z)) * this.voxelResolution;
        return this.voxels[Math.floor(x1)][Math.floor(y1)][Math.floor(z1)];
    }

    getVoxelCenter(x, y, z, tempVec) {
        let nx = (x + 0.5) * (this.boxMax.x - this.boxMin.x) / this.voxelResolution + this.boxMin.x;
        let ny = (y + 0.5) * (this.boxMax.y - this.boxMin.y) / this.voxelResolution + this.boxMin.y;
        let nz = (z + 0.5) * (this.boxMax.z - this.boxMin.z) / this.voxelResolution + this.boxMin.z;
        tempVec.set(nx, ny, nz);
        return tempVec;
    }

    getClosestPointsOnSegmentsToPoint(point) {
        let points = [];
        let segments = this.getVoxelAtPoint(point.x, point.y, point.z);
        if (segments.length > 0){
            for(let i = 0; i < segments.length; i++) {
                points.push(this.closestPointOnSegmentToPoint(segments[i], point));
            }
        }
        return points;
    }

    closestPointOnSegmentToPoint(segment, point) {
        let bax = segment[3] - segment[0];
        let bay = segment[4] - segment[1];
        let baz = segment[5] - segment[2];

        let baba = (bax * bax) + (bay * bay) + (baz * baz);

        let pax = point.x - segment[0];
        let pay = point.y - segment[1];
        let paz = point.z - segment[2];

        let paba = (pax * bax) + (pay * bay) + (paz * baz);
        let t = Math.max(0, Math.min(1, paba / baba));

        return [segment[0] + t * bax, 
                segment[1] + t * bay, 
                segment[2] + t * baz];
    }
       
    // JS code for generating points on a 3-D line 
    // using Bresenham's Algorithm
    // https://www.geeksforgeeks.org/bresenhams-algorithm-for-3-d-line-drawing/
    Bresenham3D(x1, y1, z1, x2, y2, z2) {
        x1 = Math.floor(x1);
        y1 = Math.floor(y1);
        z1 = Math.floor(z1);
        x2 = Math.floor(x2);
        y2 = Math.floor(y2);
        z2 = Math.floor(z2);

        let ListOfPoints = [];
        ListOfPoints.push([x1, y1, z1]);
        let dx = Math.abs(x2 - x1);
        let dy = Math.abs(y2 - y1);
        let dz = Math.abs(z2 - z1);
        let xs;
        let ys;
        let zs;
        if (x2 > x1) {
            xs = 1;
        } else {
            xs = -1;
        }
        if (y2 > y1) {
            ys = 1;
        } else {
            ys = -1;
        }
        if (z2 > z1) {
            zs = 1;
        } else {
            zs = -1;
        }
    
        // Driving axis is X-axis"
        if (dx >= dy && dx >= dz) {
            let p1 = 2 * dy - dx;
            let p2 = 2 * dz - dx;
            while (x1 != x2) {
                x1 += xs;
                if (p1 >= 0) {
                    y1 += ys;
                    p1 -= 2 * dx;
                }
                if (p2 >= 0) {
                    z1 += zs;
                    p2 -= 2 * dx;
                }
                p1 += 2 * dy;
                p2 += 2 * dz;
                ListOfPoints.push([x1, y1, z1]);
            }
    
            // Driving axis is Y-axis"
        } else if (dy >= dx && dy >= dz) {
            let p1 = 2 * dx - dy;
            let p2 = 2 * dz - dy;
            while (y1 != y2) {
                y1 += ys;
                if (p1 >= 0) {
                    x1 += xs;
                    p1 -= 2 * dy;
                }
                if (p2 >= 0) {
                    z1 += zs;
                    p2 -= 2 * dy;
                }
                p1 += 2 * dx;
                p2 += 2 * dz;
                ListOfPoints.push([x1, y1, z1]);
            }
    
            // Driving axis is Z-axis"
        } else {
            let p1 = 2 * dy - dz;
            let p2 = 2 * dx - dz;
            while (z1 != z2) {
                z1 += zs;
                if (p1 >= 0) {
                    y1 += ys;
                    p1 -= 2 * dz;
                }
                if (p2 >= 0) {
                    x1 += xs;
                    p2 -= 2 * dz;
                }
                p1 += 2 * dy;
                p2 += 2 * dx;
                ListOfPoints.push([x1, y1, z1]);
            }
        }
        return ListOfPoints;
    }
}

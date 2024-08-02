import createVoro from './voro_raw.js';

export type Cell = {
  particleID: number;
  x: number;
  y: number;
  z: number;
  nFaces: number;
  vertices: number[];
  faces: number[][];
  neighbors: number[];
};

export class Voro3D {
  private voroRaw: VoroRaw;
  private container: Container;
  get xMin(): number { return this.container.xMin; }
  set xMin(xMin: number) { this.container.xMin = xMin; }
  get xMax(): number { return this.container.xMax; }
  set xMax(xMax: number) { this.container.xMax = xMax; }
  get yMin(): number { return this.container.yMin; }
  set yMin(yMin: number) { this.container.yMin = yMin; }
  get yMax(): number { return this.container.yMax; }
  set yMax(yMax: number) { this.container.yMax = yMax; }
  get zMin(): number { return this.container.zMin; }
  set zMin(zMin: number) { this.container.zMin = zMin; }
  get zMax(): number { return this.container.zMax; }
  set zMax(zMax: number) { this.container.zMax = zMax; }
  get nX(): number { return this.container.nX; }
  set nX(nX: number) { this.container.nX = nX; }
  get nY(): number { return this.container.nY; }
  set nY(nY: number) { this.container.nY = nY; }
  get nZ(): number { return this.container.nZ; }
  set nZ(nZ: number) { this.container.nZ = nZ; }

  private constructor(
    voroRaw: VoroRaw,
    xMin?: number,
    xMax?: number,
    yMin?: number,
    yMax?: number,
    zMin?: number,
    zMax?: number,
    nX?: number,
    nY?: number,
    nZ?: number
  ) {
    this.voroRaw = voroRaw;
    this.container = new voroRaw.Container(
      xMin || -10,
      xMax || 10,
      yMin || -10,
      yMax || 10,
      zMin || -10,
      zMax || 10,
      nX || 1,
      nY || 1,
      nZ || 1
    );
  }

  static async create(
    xMin?: number,
    xMax?: number,
    yMin?: number,
    yMax?: number,
    zMin?: number,
    zMax?: number,
    nX?: number,
    nY?: number,
    nZ?: number
  ): Promise<Voro3D> {
    const voroRaw = await createVoro();
    return new Voro3D(voroRaw, xMin, xMax, yMin, yMax, zMin, zMax, nX, nY, nZ);
  }

  computeCells(points: number[][] | number[], convertToWorld: boolean = false): Cell[] {
    if (points.length === 0) return [];

    // Create and fill point storage
    const pointStorage = new this.voroRaw.VectorFloat();
    if (typeof points[0] === 'number') {
      (points as number[]).forEach(p => pointStorage.push_back(p));
    } else {
      (points as number[][]).forEach(p => {
        pointStorage.push_back(p[0]);
        pointStorage.push_back(p[1]);
        pointStorage.push_back(p[2]);
      });
    }

    const cellExports = this.container.computeCells(pointStorage, convertToWorld);

    // Convert VoroRaw.CellExport[] to Voro.Cell[]
    const cells: Cell[] = [];
    for (let ci = 0; ci < cellExports.size(); ++ci) {
      const ce = cellExports.get(ci);

      const vertices: number[] = new Array<number>(ce.vertices.size());
      for (let vi = 0; vi < ce.vertices.size(); ++vi) vertices[vi] = ce.vertices.get(vi);

      const faces: number[][] = new Array<number[]>(ce.faces.size());
      for (let fi = 0; fi < ce.faces.size(); ++fi) {
        const newFace = new Array<number>(ce.faces.get(fi).size());
        for (let ci = 0; ci < ce.faces.get(fi).size(); ++ci) {
          newFace[ci] = ce.faces.get(fi).get(ci);
        }
        faces[fi] = newFace;
      }

      const neighbors: number[] = new Array<number>(ce.neighbors.size());
      for (let ni = 0; ni < ce.neighbors.size(); ++ni) neighbors[ni] = ce.neighbors.get(ni);

      cells.push({
        particleID: ce.particleID,
        x: ce.x,
        y: ce.y,
        z: ce.z,
        nFaces: ce.nFaces,
        vertices,
        faces,
        neighbors
      });

      (ce as any).delete();
    }
    pointStorage.delete();
    cellExports.delete();

    return cells.sort((a, b) => (a.particleID < b.particleID ? -1 : 1));
  }
}

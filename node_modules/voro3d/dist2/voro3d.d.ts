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
export declare class Voro3D {
    private voroRaw;
    private container;
    get xMin(): number;
    set xMin(xMin: number);
    get xMax(): number;
    set xMax(xMax: number);
    get yMin(): number;
    set yMin(yMin: number);
    get yMax(): number;
    set yMax(yMax: number);
    get zMin(): number;
    set zMin(zMin: number);
    get zMax(): number;
    set zMax(zMax: number);
    get nX(): number;
    set nX(nX: number);
    get nY(): number;
    set nY(nY: number);
    get nZ(): number;
    set nZ(nZ: number);
    private constructor();
    static create(xMin?: number, xMax?: number, yMin?: number, yMax?: number, zMin?: number, zMax?: number, nX?: number, nY?: number, nZ?: number): Promise<Voro3D>;
    computeCells(points: number[][] | number[], convertToWorld?: boolean): Cell[];
}

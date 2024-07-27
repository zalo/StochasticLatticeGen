// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    let HEAPF32: any;
    let HEAPF64: any;
    let HEAP_DATA_VIEW: any;
    let HEAP8: any;
    let HEAPU8: any;
    let HEAP16: any;
    let HEAPU16: any;
    let HEAP32: any;
    let HEAPU32: any;
    let HEAP64: any;
    let HEAPU64: any;
}
interface WasmModule {
}

export interface VectorFloat {
  push_back(_0: number): void;
  resize(_0: number, _1: number): void;
  size(): number;
  get(_0: number): number | undefined;
  set(_0: number, _1: number): boolean;
  delete(): void;
}

export interface VectorInt {
  push_back(_0: number): void;
  resize(_0: number, _1: number): void;
  size(): number;
  get(_0: number): number | undefined;
  set(_0: number, _1: number): boolean;
  delete(): void;
}

export interface VectorVectorInt {
  push_back(_0: VectorInt): void;
  resize(_0: number, _1: VectorInt): void;
  size(): number;
  get(_0: number): VectorInt | undefined;
  set(_0: number, _1: VectorInt): boolean;
  delete(): void;
}

export interface VectorCellExport {
  size(): number;
  get(_0: number): CellExport | undefined;
  push_back(_0: CellExport): void;
  resize(_0: number, _1: CellExport): void;
  set(_0: number, _1: CellExport): boolean;
  delete(): void;
}

export interface CellExport {
  particleID: number;
  x: number;
  y: number;
  z: number;
  nFaces: number;
  vertices: VectorFloat;
  faces: VectorVectorInt;
  neighbors: VectorInt;
  delete(): void;
}

export interface Container {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  nX: number;
  nY: number;
  nZ: number;
  computeCells(_0: VectorFloat, _1: boolean): VectorCellExport;
  delete(): void;
}

interface EmbindModule {
  VectorFloat: {new(): VectorFloat};
  VectorInt: {new(): VectorInt};
  VectorVectorInt: {new(): VectorVectorInt};
  VectorCellExport: {new(): VectorCellExport};
  CellExport: {new(): CellExport};
  Container: {new(): Container; new(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number): Container};
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;

# Voro3D

## What does Voro3D do?
Calculate voronoi cells within a 3D box.

Voro3D is a thin wrapper around the WebAssembly output of the [Voro++ Emscripten](https://github.com/LukPopp0/Voro-Emscripten) project. It behaves like a regular module and hides loading the main `wasm` file which makes it easier to use. Also, the C++ vector types are converted into regular JavaScript arrays. TypeScript definitions are added as well.

## Usage

The module exports just one type and one class. Import the module and create a container instance:
```javascript
import { Voro3D } from 'voro3d';
const container = await Voro3D.create(-10, 10, -10, 10, -10, 10, 2, 2, 2);
```
Call the asynchronous `create` function to create a new container. The function accepts 9 optionals arguments. The first six arguments define the dimensions of the box (xMin, xMax, yMin, yMax, zMin, zMax). The last three arguments are used for the calculation of the voronoi cells where the box is divided into n respective sub computation boxes in x, y and z direction.

Now, calculate the voronoi cells. The function accepts either an array of vertices or a flattened array as well as the optional parameter to convert the vertices to world coordinates or to keep them in the cell coordinate system:
```javascript
const points = [ /* ... */ ];
const cells = container.computeCells(points, true);
```

The `cells` output is a list of `Cell` type objects. A cell contains information about their particle id, the coordinate of its particle as well as a list of vertices, faces with vertex indices, and neighboring voronoi cells.

Find a full example in the `src/test/` folder and have a look at [`voro3d.ts`](./src/voro3d.ts) for the full types.


## License

The license is based on the license of [Voro++](https://math.lbl.gov/voro++/) and can be found [here](./LICENSE).

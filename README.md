# [StochasticLatticeGen](https://zalo.github.io/StochasticLatticeGen/)

<p align="left">
  <a href="https://github.com/zalo/StochasticLatticeGen/deployments/activity_log?environment=github-pages">
      <img src="https://img.shields.io/github/deployments/zalo/StochasticLatticeGen/github-pages?label=Github%20Pages%20Deployment" title="Github Pages Deployment"></a>
  <a href="https://github.com/zalo/StochasticLatticeGen/commits/master">
      <img src="https://img.shields.io/github/last-commit/zalo/StochasticLatticeGen" title="Last Commit Date"></a>
  <!--<a href="https://github.com/zalo/StochasticLatticeGen/blob/master/LICENSE">
      <img src="https://img.shields.io/github/license/zalo/StochasticLatticeGen" title="License: Apache V2"></a>-->  <!-- No idea what license this should be! -->
</p>

Generate stochastic beam lattice structures in the browser!

TODO:
- Spawn the voronoi centers with variable density according to a density field (density check first, then interior check)
- Allow importing meshes and saving lattices

 # Building

This demo can either be run without building (in Chrome/Edge/Opera since raw three.js examples need [Import Maps](https://caniuse.com/import-maps)), or built with:
```
npm install
npm run build
```
After building, make sure to edit the index .html to point from `"./src/main.js"` to `"./build/main.js"`.

 # Dependencies
 - [Voro3D](https://github.com/LukPopp0/voro3d) (Voronoi Cell Computation)
 - [three.js](https://github.com/mrdoob/three.js/) (3D Rendering Engine)
 - [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) (Accelerated Raycasting and Closest Point Queries)
 - [esbuild](https://github.com/evanw/esbuild/) (Bundler)

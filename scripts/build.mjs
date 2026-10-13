// Bundles the demo (main thread + worker) into ./build as a self-contained static site.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const outDir = 'build';
await rm(outDir, { recursive: true, force: true });
await mkdir(`${outDir}/assets`, { recursive: true });

await build({
  entryPoints: ['src/demo/main.js', 'src/demo/LatticeWorker.js'],
  outdir: outDir,
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  // Node-only branches inside the emscripten loaders reference these; they never run in the browser.
  external: ['node:*', 'module', 'fs', 'path', 'url'],
  logLevel: 'info',
});

// The wasm binaries are located relative to the bundles via import.meta.url.
await cp('node_modules/manifold-3d/manifold.wasm', `${outDir}/manifold.wasm`);
await cp('node_modules/voro3d/dist/voro_raw.wasm', `${outDir}/voro_raw.wasm`);
await cp('assets/armadillo.obj', `${outDir}/assets/armadillo.obj`);

const html = (await readFile('index.html', 'utf8'))
  .replace(/\s*<!-- Import map:[\s\S]*?-->/, '')
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace('./src/demo/main.js', './main.js');
await writeFile(`${outDir}/index.html`, html);
console.log(`Static site written to ./${outDir}`);

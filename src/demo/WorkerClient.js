/**
 * Creates a module worker. When the page relies on an import map (the
 * un-bundled development setup), browsers can't apply it inside workers, so
 * the worker is bootstrapped through es-module-shims instead.
 * @param {URL|string} scriptURL
 */
export function createModuleWorker(scriptURL) {
  const importMapScript = document.querySelector('script[type="importmap"]');
  if (!importMapScript) {
    return new Worker(scriptURL, { type: 'module' });
  }
  const importMap = JSON.parse(importMapScript.textContent);
  const absolute = (url) => new URL(url, document.baseURI).href;
  const shimURL = importMap.imports['es-module-shims'];
  if (!shimURL) { throw new Error('The import map needs an "es-module-shims" entry to run workers without bundling.'); }
  for (const key of Object.keys(importMap.imports)) { importMap.imports[key] = absolute(importMap.imports[key]); }
  const bootstrap = `
    importScripts(${JSON.stringify(absolute(shimURL))});
    importShim.addImportMap(${JSON.stringify(importMap)});
    importShim(${JSON.stringify(absolute(scriptURL))}).catch((e) => setTimeout(() => { throw e; }));`;
  return new Worker(URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' })));
}

/**
 * Promise-based RPC client for `LatticeWorker.js`.
 * Progress reports from the worker are forwarded to `onProgress(stage, fraction)`.
 */
export class WorkerClient {
  constructor(scriptURL, { onProgress } = {}) {
    this.onProgress = onProgress;
    this.pending = new Map();
    this.nextId = 1;
    this.worker = createModuleWorker(scriptURL);
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.worker.onmessage = (event) => this._receive(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Worker failed to start');
      this._rejectReady(error);
      for (const { reject } of this.pending.values()) { reject(error); }
      this.pending.clear();
    };
  }

  /**
   * Calls `method` on the worker. `transfer` lists ArrayBuffers to hand over without copying.
   * @returns {Promise<any>}
   */
  call(method, args = {}, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args }, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
    this.pending.clear();
  }

  _receive(message) {
    if (message.ready) { this._resolveReady(); return; }
    if (message.progress) { this.onProgress?.(message.progress.stage, message.progress.fraction); return; }
    const request = this.pending.get(message.id);
    if (!request) { return; }
    this.pending.delete(message.id);
    if (message.error !== undefined) { request.reject(new Error(message.error)); }
    else { request.resolve(message.result); }
  }
}

// src/EventHandler.js
var EventHandler = class {
  /** @type {Function|null} */
  onclick = null;
  /** @type {Function|null} */
  onmessage = null;
  /** @type {Record<string, Set<Function>>} */
  events = {};
  /**
   * @param {string} type - The event type.
   * @param {Function} cb - The callback.
   */
  addEventListener(type, cb) {
    this.events[type] ??= /* @__PURE__ */ new Set();
    this.events[type].add(cb);
  }
  /**
   * @param {string} type - The event type.
   * @param {Function} cb - The callback.
   */
  removeEventListener(type, cb) {
    this.events[type]?.delete(cb);
  }
  /**
   * @param {Event} event - The event.
   */
  dispatchEvent(event) {
    const { type } = event;
    this["on" + type]?.(event);
    this.events[type]?.forEach((listener) => listener(event));
  }
};

// src/getImportMap.js
function getImportMap() {
  const e = document.querySelector('script[type="importmap"]');
  if (!e?.textContent) {
    return;
  }
  return JSON.parse(e.textContent);
}

// src/WorkerWithImportMapViaBedfordsShim.js
var WorkerWithImportMapViaBedfordsShim = class extends Worker {
  /**
   * @param {string | URL} scriptURL - The URL.
   * @param {WorkerOptions & {importMap?: 'inherit', debug?: boolean}} [options] - The options.
   */
  constructor(scriptURL, options = {}) {
    if (!options.importMap || options.importMap === "inherit") {
      const shimURL = new URL("../assets/WorkerWithImportMapViaBedfordsShim.worker.js", import.meta.url) + "";
      super(shimURL);
      const importMap = getImportMap();
      const baseURL = document.baseURI.split("/").slice(0, -1).join("/");
      if (options.debug) {
        console.log("WorkerWithImportMapViaBedfordsShim debug information", { importMap, shimURL, baseURL, options });
      }
      scriptURL += "";
      this.postMessage({ type: "init-worker-with-import-map", importMap, scriptURL, baseURL, options });
    } else {
      super(scriptURL, options);
    }
  }
};

// src/WorkerWithImportMapViaInlineFrame.js
window.workersReady = {};
var WorkerWithImportMapViaInlineFrame = class extends EventHandler {
  debug = false;
  iframe = document.createElement("iframe");
  callbackId = `cb${Math.floor(Math.random() * 1e9)}`;
  terminateId = `tm${Math.floor(Math.random() * 1e9)}`;
  /**
   * @param {URL | string} script - The worker URL.
   * @param {object} [options] - The options.
   * @param {object|'inherit'} [options.importMap] - The import map or simply `inherit`.
   * @returns 
   */
  constructor(script, options = {}) {
    super();
    const { iframe, callbackId, terminateId } = this;
    if (options.importMap === "inherit") {
      options.importMap = getImportMap();
    }
    if (!options.importMap) {
      return new window.Worker(script, options);
    }
    window.workersReady[terminateId] = function(window2) {
      iframe.remove();
    };
    this.ready = new Promise((resolve, reject) => {
      window.workersReady[callbackId] = function(window2) {
        resolve();
      };
    });
    const html = `
<html>
  <head>
      <script type="importmap">${JSON.stringify(options.importMap)}<\/script>
  </head>
  <body onload="parent.workersReady.${callbackId}(this.window)">
    <script>
      ${EventHandler};
      class Self extends EventHandler {
        postMessage(e) {
          parent.postMessage(e);
        }
      };
      const self = new Self();
      window.self = self;
      window.onmessage = (e) => {
        self.dispatchEvent(e);
      };
    <\/script>
    <script type="module" src="${script}"><\/script>
  </body>
</html>`;
    if (!this.debug) {
      iframe.style.display = "none";
    }
    document.body.appendChild(iframe);
    iframe.contentWindow.document.open();
    iframe.contentWindow.document.write(html);
    iframe.contentWindow.document.close();
    window.onmessage = (e) => {
      this.dispatchEvent(e);
    };
  }
  postMessage(data) {
    this.iframe.contentWindow.postMessage(data, "*");
  }
  terminate() {
    window.workersReady[this.terminateId]();
  }
};
export {
  EventHandler,
  WorkerWithImportMapViaBedfordsShim as Worker,
  WorkerWithImportMapViaBedfordsShim,
  WorkerWithImportMapViaInlineFrame,
  getImportMap
};
//# sourceMappingURL=index.js.map

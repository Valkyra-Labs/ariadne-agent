// The Service Worker that streams the run. It is its own bundle, built from
// src/sw.ts with the engine inlined, and served at a fixed path next to the
// page (`<base>sw.js`): a fixed URL is what lets the browser compare the
// deployed script with the installed one and update it, and a worker at the
// base path may control every page under it.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, type Connect, type Plugin } from "vite";

const ENTRY = fileURLToPath(new URL("./src/sw.ts", import.meta.url));
const FILE = "sw.js";

/** The worker as one classic script, with no imports left in it. */
async function bundleWorker(minify: boolean): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    build: {
      write: false,
      minify,
      sourcemap: false,
      emptyOutDir: false,
      lib: { entry: ENTRY, formats: ["iife"], name: "ariadneWorker", fileName: () => FILE },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) {
    if (!("output" in output)) continue;
    for (const chunk of output.output) if (chunk.type === "chunk") return chunk.code;
  }
  throw new Error("The service worker bundle produced no code");
}

function send(res: Parameters<Connect.NextHandleFunction>[1], code: string) {
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  // The browser revalidates a worker script itself; this keeps any proxy
  // in between from serving an old one.
  res.setHeader("Cache-Control", "no-cache");
  res.end(code);
}

/** A revision appended to the served script, from a cookie the end-to-end
 * tests set in their own browser context: changing it makes the browser
 * see a new worker, which is how a deployment updates it. Only with
 * ARIADNE_E2E=1, and only on the preview server. */
function e2eRevision(cookie: string | undefined): string | null {
  const match = /(?:^|;\s*)ariadne-sw-revision=(\d{1,6})/.exec(cookie ?? "");
  return match?.[1] ?? null;
}

export function serviceWorker(): Plugin {
  let base = "/";
  let outDir = "dist";
  return {
    name: "ariadne-service-worker",
    configResolved(config) {
      base = config.base;
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== `${base}${FILE}`) return next();
        try {
          send(res, await bundleWorker(false));
        } catch (error) {
          next(error);
        }
      });
    },
    configurePreviewServer(server) {
      if (process.env.ARIADNE_E2E !== "1") return;
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== `${base}${FILE}`) return next();
        try {
          const code = await readFile(`${outDir}/${FILE}`, "utf8");
          const revision = e2eRevision(req.headers.cookie);
          send(res, revision === null ? code : `${code}\n// revision ${revision}\n`);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      if (this.environment.name !== "client") return;
      this.emitFile({ type: "asset", fileName: FILE, source: await bundleWorker(true) });
    },
  };
}

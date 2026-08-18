import { configDefaults, defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { MAP_EDITOR_PALETTE_API, MAP_TILE_INPUT_DIR, MAP_TILE_PALETTE_API, MAP_TILE_PALETTE_FILE, buildMapTileAssets, savePaletteAtomically } from "./scripts/map-tile-pipeline.mjs";
import { analyzeImport, commitImport } from "./scripts/asset-import-pipeline.mjs";

function mapTilePipelinePlugin(): Plugin {
  const importSessions = new Map<string, { expiresAt: number; analysis: ReturnType<typeof analyzeImport> }>();
  const publicAnalysis = (analysis: ReturnType<typeof analyzeImport>) => JSON.parse(JSON.stringify(analysis, (key, value) => key.startsWith("_") ? undefined : value));
  const readBody = (request: import("node:http").IncomingMessage): Promise<Buffer> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on("data", (chunk: Buffer | string) => { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += value.length; if (length > 100 * 1024 * 1024) { reject(new Error("import payload too large")); request.destroy(); return; } chunks.push(value); });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
  const jsonBody = (request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> => readBody(request).then((bytes) => JSON.parse(bytes.toString("utf8")));
  const cleanupImports = () => { const now = Date.now(); for (const [id, session] of importSessions) if (session.expiresAt <= now) importSessions.delete(id); };
  return {
    name: "map-tile-pipeline",
    configureServer(server) {
      let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
      const rebuild = () => {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
          try {
            buildMapTileAssets();
            server.ws.send({ type: "full-reload" });
          } catch (error) {
            server.config.logger.error(error instanceof Error ? error.message : String(error));
          }
        }, 80);
      };
      const watchedRoot = MAP_TILE_INPUT_DIR.replaceAll("\\", "/");
      server.watcher.on("add", (file) => { if (file.replaceAll("\\", "/").startsWith(watchedRoot)) rebuild(); });
      server.watcher.on("change", (file) => { if (file.replaceAll("\\", "/").startsWith(watchedRoot)) rebuild(); });
      server.watcher.on("unlink", (file) => { if (file.replaceAll("\\", "/").startsWith(watchedRoot)) rebuild(); });
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        cleanupImports();
        if (pathname === "/__map-editor/import/analyze") {
          if (request.method !== "POST") { response.statusCode = 405; response.setHeader("Allow", "POST"); response.end("Method Not Allowed"); return; }
          void readBody(request).then((bytes) => {
            const fileName = decodeURIComponent(String(request.headers["x-import-filename"] ?? "input"));
            const analysis = analyzeImport(bytes, { fileName });
            const id = randomUUID();
            importSessions.set(id, { expiresAt: Date.now() + 30 * 60 * 1000, analysis });
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ id, analysis: publicAnalysis(analysis) }));
          }).catch((error) => { response.statusCode = 400; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); });
          return;
        }
        const commitMatch = pathname?.match(/^\/__map-editor\/import\/([^/]+)\/commit$/);
        if (commitMatch) {
          if (request.method !== "POST") { response.statusCode = 405; response.setHeader("Allow", "POST"); response.end("Method Not Allowed"); return; }
          const session = importSessions.get(commitMatch[1]!);
          if (!session) { response.statusCode = 404; response.end("import session expired"); return; }
          void jsonBody(request).then((decisions) => {
            const mapTiles = Array.isArray(decisions.mapTiles) ? decisions.mapTiles.map((value) => ({ ...session.analysis.mapTiles.find((candidate) => candidate.id === value.id), ...value })) : session.analysis.mapTiles;
            const actors = Array.isArray(decisions.actors) ? decisions.actors.map((value) => ({ ...session.analysis.actors.find((candidate) => candidate.id === value.id), ...value })) : session.analysis.actors;
            const result = commitImport(session.analysis, { mapTiles, actors, createPalettePages: decisions.createPalettePages === true, licenseAcknowledged: decisions.licenseAcknowledged === true });
            importSessions.delete(commitMatch[1]!);
            buildMapTileAssets();
            server.ws.send({ type: "full-reload" });
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ok: true, created: result.created.map((file) => file.replaceAll("\\", "/")) }));
          }).catch((error) => { response.statusCode = 400; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); });
          return;
        }
        const canonical = pathname === MAP_EDITOR_PALETTE_API;
        const legacy = pathname === MAP_TILE_PALETTE_API;
        if (!canonical && !legacy) { next(); return; }
        if (request.method === "GET") {
          try {
            const body = requirePaletteSource();
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(body));
          } catch (error) {
            response.statusCode = 500;
            response.end(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        const writeMethod = canonical ? "PUT" : "POST";
        if (request.method !== writeMethod) { response.statusCode = 405; response.setHeader("Allow", canonical ? "GET, PUT" : "GET, POST"); response.end("Method Not Allowed"); return; }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 5_000_000) request.destroy(new Error("palette payload too large"));
        });
        request.on("end", () => {
          try {
            const saved = savePaletteAtomically(JSON.parse(body));
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ok: true, pages: saved.palette.pages.length }));
          } catch (error) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
          }
        });
      });
    },
  };
}

function requirePaletteSource(): unknown {
  // This module is loaded once by Vite; reading on demand keeps GET in sync with edits.
  return JSON.parse(fs.readFileSync(MAP_TILE_PALETTE_FILE, "utf8"));
}

export default defineConfig({
  plugins: [mapTilePipelinePlugin()],
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        game: "index.html",
        review: "review.html",
      },
    },
  },
  test: {
    exclude: configDefaults.exclude,
  },
});

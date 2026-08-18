import { configDefaults, defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import fs from "node:fs";
import { MAP_EDITOR_PALETTE_API, MAP_TILE_INPUT_DIR, MAP_TILE_PALETTE_API, MAP_TILE_PALETTE_FILE, buildMapTileAssets, savePaletteAtomically } from "./scripts/map-tile-pipeline.mjs";

function mapTilePipelinePlugin(): Plugin {
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

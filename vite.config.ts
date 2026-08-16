import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
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
    // Unity/ holds C# sources and the vendored MCP-for-Unity checkout. Its
    // JavaScript tests belong to that project and are not run from here; picking
    // them up leaves `npm test` permanently red and useless as a regression signal.
    exclude: [...configDefaults.exclude, "Unity/**"],
  },
});

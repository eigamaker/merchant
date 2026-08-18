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
    exclude: configDefaults.exclude,
  },
});

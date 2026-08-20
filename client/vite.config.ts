import { defineConfig } from "vite";

// The server URL is the only build-time knob: localhost in dev, wss://api.…
// in production. Everything else about the client is static.
export default defineConfig({
  server: {
    port: 5173,
    watch: {
      // @pollen/shared is a linked workspace that compiles to dist/. Vite does
      // not watch inside node_modules by default, so rebuilding shared left the
      // browser running stale code with no indication anything was wrong.
      ignored: ["!**/shared/dist/**"],
    },
  },
  optimizeDeps: {
    // Never pre-bundle the local workspace package. Its dist/ changes whenever
    // we touch shared types, and a cached optimized copy silently serves the
    // old exports — which surfaces as a missing-export SyntaxError in the
    // browser rather than anything that points at the real cause.
    exclude: ["@pollen/shared"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});

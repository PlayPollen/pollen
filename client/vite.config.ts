import { defineConfig } from "vite";

// The client builds to fully static files — there is no server URL or API
// endpoint to configure. The whole game runs in the browser.
export default defineConfig(({ mode }) => ({
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

    // Off for production: the sourcemap is ~10MB against a ~1.5MB bundle, so it
    // was 87% of every deploy for something almost nobody downloads.
    //
    // `npm run build:debug` turns it back on. That uses Vite's --mode rather
    // than an env var so it behaves the same on Windows and Linux, and "debug"
    // (not "development") keeps minification and NODE_ENV=production intact —
    // the point is to debug the REAL production bundle, not a different one.
    sourcemap: mode === "debug",
  },
}));

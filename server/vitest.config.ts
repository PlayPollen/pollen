import { defineConfig } from "vitest/config";

// Vitest uses esbuild, which needs to be told about decorators separately from
// tsc. Without this, tests on files importing the schema classes throw
// "Invalid or unexpected token" on the @type decorators.
export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

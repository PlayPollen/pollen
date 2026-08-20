// Flat config (ESLint 9). Covers every workspace from the repo root, so there
// is one lint contract for the whole monorepo rather than per-package drift.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // server/ is parked and does not currently compile — see server/README.md.
    ignores: ["**/dist/**", "**/node_modules/**", "client/public/**", "server/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Colyseus decodes room state via schema reflection on the client, so the
      // replica genuinely has no static type. Banning `any` here would just
      // push everyone to write worse casts.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

// ESLint for the React UI in app/src. `npm run lint` runs it from the repo root: with --config,
// ESLint ignores every file outside the working directory, so it cannot be started from tools/.
//
// The UI code predates this lint, so the gate is "0 errors": the rules that catch real bugs
// (Rules of Hooks, TypeScript correctness) stay errors, while the React Compiler diagnostics,
// `any` and exhaustive-deps are warnings until Phase 1 splits App.tsx and fixes them.
import { fileURLToPath } from "node:url";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// react-hooks' compiler-backed rules ship as errors in its recommended set; demote them to
// warnings so they are reported without failing the gate on the pre-design-system code.
const hooksRules = Object.fromEntries(
  Object.entries(reactHooks.configs["recommended-latest"].rules).map(([rule, level]) => [
    rule,
    rule === "react-hooks/rules-of-hooks" ? "error" : level === "off" ? "off" : "warn",
  ]),
);

export default defineConfig([
  {
    // The config lives in tools/, the code in app/: anchor every pattern at the app folder.
    basePath: fileURLToPath(new URL("../app", import.meta.url)),
    files: ["src/**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      ...hooksRules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

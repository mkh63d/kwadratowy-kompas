import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const RAW_BUILDERS = {
  wrapper: {
    generated: ["query", "mutation", "action"],
    generic: ["queryGeneric", "mutationGeneric", "actionGeneric"],
    message:
      "Public Convex functions use the wrappers from convex/lib/functions.ts (spec §5.3).",
  },
  http: {
    generated: ["httpAction"],
    generic: ["httpActionGeneric"],
    message:
      "HTTP actions live only in convex/http.ts and convex/*/httpHandler.ts (spec §5.3).",
  },
};

function restrictRawBuilders({ allow = [], allowGeneric = false } = {}) {
  const restricted = Object.entries(RAW_BUILDERS)
    .filter(([kind]) => !allow.includes(kind))
    .map(([, builders]) => builders);
  return [
    "error",
    {
      patterns: restricted.map(({ generated, message }) => ({
        group: ["**/_generated/server"],
        importNames: generated,
        message,
      })),
      paths: allowGeneric
        ? []
        : restricted.map(({ generic, message }) => ({
            name: "convex/server",
            importNames: generic,
            message,
          })),
    },
  ];
}

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-e2e",
      "coverage",
      "reports",
      "convex/_generated",
      "playwright-report",
      "test-results",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    rules: { "no-restricted-imports": restrictRawBuilders() },
  },
  {
    files: ["convex/lib/functions.ts"],
    rules: {
      "no-restricted-imports": restrictRawBuilders({ allow: ["wrapper"] }),
    },
  },
  {
    files: ["convex/http.ts", "convex/*/httpHandler.ts"],
    rules: {
      "no-restricted-imports": restrictRawBuilders({ allow: ["http"] }),
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": restrictRawBuilders({ allowGeneric: true }),
    },
  },
  prettier,
);

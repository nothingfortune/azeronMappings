import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["build/**", "dist/**", "coverage/**", "node_modules/**", ".claude/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // Only this file and scripts/check-env.mjs are JavaScript, and both are type-checked
  // by tsc via checkJs. ESLint's own config cannot be type-aware about itself.
  { files: ["eslint.config.js"], ...tseslint.configs.disableTypeChecked },
  prettier,
);

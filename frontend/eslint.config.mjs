import { dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: dirname(createRequire(import.meta.url).resolve("eslint-config-next/package.json")),
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Existing native payloads are gradually typed. Keep them visible as warnings.
  { rules: { "@typescript-eslint/no-explicit-any": "warn" } },
];

export default eslintConfig;

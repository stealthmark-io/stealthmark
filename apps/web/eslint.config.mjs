import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// eslint-config-next was dropped: its @next/eslint-plugin-next pulls fast-glob -> braces,
// which has an unpatched advisory (GHSA-vfj7-8cjw-p6xm). TypeScript and React Hooks rules cover what CI needs.
const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;

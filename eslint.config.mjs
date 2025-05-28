import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Define __dirname for ES module

export default [{
    files: ["**/src/*.ts"],
    ignores: ["**", "!**/src/*.ts"],
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },
    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
        parserOptions: {
            project: "./tsconfig.json",
            tsconfigRootDir: __dirname, // Use the derived __dirname
        },
    },
    rules: {
        // forces await on async functions
        "@typescript-eslint/no-floating-promises": "error", 

        "@typescript-eslint/require-await": "error",
        "@typescript-eslint/await-thenable": "error",
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],
        curly: "off",
        eqeqeq: "off",
        "no-throw-literal": "warn",
        semi: "warn",
        "no-unused-vars": "warn",
    },
}];
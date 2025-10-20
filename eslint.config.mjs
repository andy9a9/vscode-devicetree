import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
        parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
        },
    },

    rules: {
        // TypeScript-specific rules
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],
        "@typescript-eslint/no-unused-vars": ["warn", {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
        }],
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/explicit-function-return-type": ["warn", {
            allowExpressions: true,
            allowTypedFunctionExpressions: true,
        }],
        "@typescript-eslint/no-non-null-assertion": "warn",
        "@typescript-eslint/prefer-nullish-coalescing": "warn",
        "@typescript-eslint/prefer-optional-chain": "warn",
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/await-thenable": "error",

        // General code quality
        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
        "no-console": ["warn", { allow: ["warn", "error"] }],
        "prefer-const": "warn",
        "no-var": "error",
        "prefer-arrow-callback": "warn",
        "no-duplicate-imports": "error",

        // Code complexity
        "max-depth": ["warn", 4],
        "max-lines-per-function": ["warn", { max: 100, skipBlankLines: true, skipComments: true }],
        complexity: ["warn", 15],
    },
}];

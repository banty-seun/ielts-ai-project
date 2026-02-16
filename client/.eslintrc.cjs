const hasTsEslint = (() => {
  try {
    require.resolve("@typescript-eslint/parser");
    require.resolve("@typescript-eslint/eslint-plugin");
    return true;
  } catch {
    return false;
  }
})();

const baseRule = ["error", { functions: false, classes: true, variables: true }];

module.exports = {
  overrides: [
    {
      files: ["src/**/*.{ts,tsx}"],
      env: {
        browser: true,
        es2021: true,
      },
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
      },
      ...(hasTsEslint
        ? {
            parser: "@typescript-eslint/parser",
            plugins: ["@typescript-eslint"],
            rules: {
              "@typescript-eslint/no-use-before-define": baseRule,
            },
          }
        : {
            rules: {
              "no-use-before-define": baseRule,
            },
          }),
    },
  ],
};

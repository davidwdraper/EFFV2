module.exports = {
  overrides: [
    {
      files: ["src/**/*.ts", "src/**/*.tsx"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "axios",
                message: "Use src/utils/s2sClient.ts for internal calls",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/utils/s2sClient.ts"],
      rules: { "no-restricted-imports": "off" },
    },
  ],
};

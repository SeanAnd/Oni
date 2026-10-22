const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['.cache/**', 'dist/**', 'android/**', 'ios/**', 'coverage/**', '.expo/**', 'packages/decode-uri-component/index.cjs'] },
]);

import js from "@eslint/js"
import globals from "globals"
import pluginVue from "eslint-plugin-vue"
import json from "@eslint/json"
// import css from "@eslint/css"
import { defineConfig } from "eslint/config"

export default defineConfig([
    { files: ["**/*.{js,mjs,cjs,vue}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
    pluginVue.configs["flat/essential"],
    { files: ["**/*.jsonc"], plugins: { json }, language: "json/jsonc", extends: ["json/recommended"] },
    // { files: ["**/*.css"], plugins: { css }, language: "css/css", extends: ["css/recommended"] },
    {
        rules: {
            "no-unused-vars": 1,
            semi: [1, "never"],
            indent: [1, 4],
            "vue/multi-word-component-names": 0,
            "vue/return-in-computed-property": 0,
            "vue/no-unused-components": 1,
            "no-useless-catch": 0,
            "no-constant-condition": 1,
            "object-curly-spacing": [1, "always"],
            "comma-dangle": [1, "always-multiline"],
        },
    },
])

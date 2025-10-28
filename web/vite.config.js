import { defineConfig } from 'vite'
// import basicSsl from '@vitejs/plugin-basic-ssl'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import fs from 'fs'

const oneYearInSeconds = 60 * 60 * 24 * 365

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        vue(),
        AutoImport({
            resolvers: [ElementPlusResolver()],
        }),
        Components({
            resolvers: [ElementPlusResolver()],
        }),
        // basicSsl(),
    ],
    server: process.env.NODE_DEV === 'production' && {
        host: '0.0.0.0',
        https: {
            key: fs.readFileSync('../localhost+3-key.pem'),
            cert: fs.readFileSync('../localhost+3.pem'),
        },
        headers: {
            'Strict-Transport-Security': `max-age=${oneYearInSeconds}`,
        },
    },
})

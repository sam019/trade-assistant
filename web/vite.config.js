import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

const backendTarget = 'http://127.0.0.1:3000'

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
    ],
    server: process.env.NODE_ENV !== 'production' && {
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: backendTarget,
                changeOrigin: true,
                rewrite: path => path.replace(/^\/api/, ''),
            },
            '/socket.io': {
                target: backendTarget,
                ws: true,
            },
        },
    },
})

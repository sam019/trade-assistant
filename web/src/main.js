import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import { isDev, isMobileDevice } from 'share/utils'
import './style.css'
import App from './App.vue'

// 解决报错 Unable to preventDefault inside passive event listener invocation
if (typeof EventTarget !== "undefined") {
    let func = EventTarget.prototype.addEventListener
    EventTarget.prototype.addEventListener = function (type, fn, capture) {
        this.func = func
        if (typeof capture !== "boolean") {
            capture = capture || {}
            capture.passive = false
        }
        this.func(type, fn, capture)
    }
}

// 移动端引入vConsole调试
if (isDev() && isMobileDevice()) {
    const VConsole = await import('vconsole')
    // console.log('VConsole', VConsole)
    const vConsole = new VConsole.default()
}

const app = createApp(App)
app.use(ElementPlus)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
}
app.mount('#app')

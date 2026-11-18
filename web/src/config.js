
// 开发环境由 Vite 代理转发到后端，生产环境由 Caddy 同源转发，前端只使用同源地址
export const apiURL = '/api'
export const wsURL = location.origin

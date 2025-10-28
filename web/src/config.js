
let _apiURL
let _wsURL
if (import.meta.env.PROD) {
    _apiURL = location.origin + '/api'
    // _wsURL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
    _wsURL = location.origin
} else {
    _apiURL = location.protocol + '//' + location.hostname + ':' + import.meta.env.VITE_API_PORT
    _wsURL = _apiURL
}
// console.log('config apiURL: ', _apiURL, _wsURL)
export const apiURL = _apiURL
export const wsURL = _wsURL
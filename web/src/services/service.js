import axios from 'axios'
import { apiURL } from '../config'
// import socket from './socket'

const service = axios.create({
    baseURL: apiURL,
    withCredentials: true,
    // timeout: 1000,
})

// service.interceptors.request.use(function (config) {
//     // Do something before request is sent
//     // config.data = Object.assign(config.data || {}, { socketId: socket?.socket.id })
//     // console.log('interceptors request', config.data, socket.socket)
//     return config
// }, function (error) {
//     // Do something with request error
//     return Promise.reject(error)
// })

export async function getSupportedExchanges() {
    const response = await service.post('/exchange/supported')
    return response.data
}

export async function getMarket(exchange, symbol) {
    const response = await service.post('/market/get', { exchange, symbol })
    return response.data
}

export async function searchMarkets(exchange, keywords, refreshMarket) {
    const response = await service.post('/market/search', { exchange, keywords, refreshMarket })
    return response.data
}

export async function addFavouriteMarket(exchange, symbol) {
    const response = await service.post('/market/addFavorite', { exchange, symbol })
    return response.data
}

export async function deleteFavoriteMarket(exchange, symbol) {
    const response = await service.post('/market/deleteFavorite', { exchange, symbol })
    return response.data
}

export async function createOrder(order) {
    const response = await service.post('/order/create', order)
    return response.data
}

export async function deleteOrder(_id) {
    const response = await service.post('/order/delete', { _id })
    return response.data
}
export async function getLeverage(exchange, symbol) {
    const response = await service.post('/market/getLeverage', { exchange, symbol })
    return response.data
}

export async function setLeverage(exchange, symbol, leverage) {
    const response = await service.post('/market/setLeverage', { exchange, symbol, leverage })
    return response.data
}

export async function getMarginMode(exchange, symbol) {
    const response = await service.post('/market/getMarginMode', { exchange, symbol })
    return response.data
}

export async function setMarginMode(exchange, symbol, mode) {
    const response = await service.post('/market/setMarginMode', { exchange, symbol, mode })
    return response.data
}

export async function closePosition(exchange, symbol) {
    const response = await service.post('/position/close', { exchange, symbol })
    return response.data
}

export async function login(pwd) {
    const response = await service.post('/auth', { pwd })
    return response.data
}

// export default service;
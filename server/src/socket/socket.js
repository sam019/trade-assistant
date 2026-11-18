import { Server } from 'socket.io'

import { ioAuth } from '../auth/auth.js'
import socketHandler from './socketHandler.js'

let _io
export async function serve({
    server,
}) {
    if (_io) {
        return _io
    }
    _io = new Server(server, {}) // 必须要有第二个参数，否则会报错
    _io.use(ioAuth)
    _io.on('connection', socketHandler)
    return _io
}

export function io() {
    return _io
}

export default {
    io,
    serve,
}
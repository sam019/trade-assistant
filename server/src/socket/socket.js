import { Server } from 'socket.io'

import { ioAuth } from '../auth/auth.js'
import socketHandler from './socketHandler.js'

let _io
export async function serve({
    server,
    corsOrigin,
}) {
    if (_io) {
        return _io
    }
    _io = new Server(server, {
        cors: {
            origin: corsOrigin,
            credentials: true,
            maxAge: 7200, // 加了这个ios26的safari才能通过cors校验，原因未知
        },
    })
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
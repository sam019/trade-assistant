import { Server } from 'socket.io'
import type { Server as HTTPServer } from 'node:https'
import { ioAuth } from '../auth/auth.js'
import socketHandler from './socketHandler.js'
import { CORS_MAX_AGE } from '../config.js'

let _io: Server | undefined

interface ServeParams {
    server: HTTPServer
    corsOrigin: string[]
}

export async function serve({
    server,
    corsOrigin,
}: ServeParams): Promise<Server> {
    if (_io) {
        return _io
    }
    _io = new Server(server, {
        cors: {
            origin: corsOrigin,
            credentials: true,
            maxAge: CORS_MAX_AGE,
        },
    })
    _io.use(ioAuth)
    _io.on('connection', socketHandler)
    return _io
}

export function io(): Server | undefined {
    return _io
}

export default {
    io,
    serve,
}


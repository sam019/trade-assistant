import crypto from 'crypto'
import { Hono } from 'hono'
import {
    setCookie,
    getCookie,
} from 'hono/cookie'
import { readFileSync } from 'fs'
import { isDev } from 'share/utils.js'
import type { Socket } from 'socket.io'
import type { Context, Next } from 'hono'

import { COOKIE_MAX_AGE } from '../config.js'

const hash = crypto.createHash('sha256')
const cookieKey = 'test'
const noAuthText = 'Hellow World'

class Auth {
    pwdHash: string
    
    constructor() {
        const pwd = isDev() ? process.env.PASSWORD : readFileSync('/run/secrets/PASSWORD', 'utf8').trim()
        if (!pwd) {
            throw new Error('Password must exist')
        }
        this.pwdHash = hash.update(pwd).digest('hex')
    }
    
    verify(pwd: string | undefined | null): boolean {
        return pwd === this.pwdHash
    }
}

const auth = new Auth()
const app = new Hono()

app.post('/', async function authorize(c) {
    const body = await c.req.json() as { pwd?: string }
    if (auth.verify(body.pwd)) {
        setCookie(c, cookieKey, body.pwd!, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: COOKIE_MAX_AGE,
        })
        return c.text('ok')
    }
    return c.text(noAuthText, 401)
})

function getPwdFromCookie(cookie: string = '', key: string): string | null {
    const match = cookie.match(new RegExp(`(^| )${key}=([^;]+)`))
    return match ? decodeURIComponent(match[2]) : null
}

export function ioAuth(socket: Socket, next: (err?: Error) => void): void {
    const cookie = socket.handshake.headers.cookie || ''
    const pwd = getPwdFromCookie(cookie, cookieKey)
    if (auth.verify(pwd)) {
        next()
    } else {
        const err = new Error('no')
        next(err)
    }
}

export async function httpAuth(c: Context, next: Next): Promise<void | Response> {
    if (c.req.path === '/auth') {
        await next()
    } else if (auth.verify(getCookie(c, cookieKey))) {
        await next()
    } else {
        return c.text(noAuthText, 401)
    }
}

export const authRouter = app
export default auth


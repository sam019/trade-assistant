import crypto from 'crypto'
import { Hono } from 'hono'
import {
    setCookie,
    getCookie,
} from 'hono/cookie'
import fs from 'fs'

import { isDev } from '../../../share/utils.js'

const hash = crypto.createHash('sha256')
const cookieKey = 'test'
const noAuthText = 'Hellow World'

class Auth {
    
    constructor() {
        const pwd = isDev() ? process.env.PASSWORD : fs.readFileSync('/run/secrets/PASSWORD')
        if(!pwd) {
            throw new Error('Password must exist')
        }
        this.pwdHash = hash.update(pwd).digest('hex')
    }
    verify(pwd) {
        return pwd === this.pwdHash
    }
}

const auth = new Auth()
const app = new Hono()

app.post('/', async function authorize(c) {
    const body = await c.req.json()
    // console.log('authorize', auth.pwdHash, body)
    if (auth.verify(body.pwd)) {
        setCookie(c, cookieKey, body.pwd, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 24 * 60 * 60,
        })
        return c.text('ok')
    }
    return c.text(noAuthText, 401)
})
function getPwdFromCookie(cookie = '', key) {
    const match = cookie.match(new RegExp(`(^| )${key}=([^;]+)`))
    // console.log('getCookie', cookie.split(';'))
    return match ? decodeURIComponent(match[2]) : null
}

export function ioAuth(socket, next) {
    const cookie = socket.handshake.headers.cookie
    const pwd = getPwdFromCookie(cookie, cookieKey)
    // console.log('ioAuth', pwd)
    if (auth.verify(pwd)) {
        next()
    } else {
        const err = new Error('no')
        next(err)
    }
}

export async function httpAuth(c, next) {
    // console.log('httpAuth', c.req.path, getCookie(c, cookieKey))
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
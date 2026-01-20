declare global {
    var __Force: {
        v: () => boolean
        sl: () => boolean
        tp: () => boolean
        f: (sl?: boolean) => void
        c: () => void
    } | undefined
}

export {}



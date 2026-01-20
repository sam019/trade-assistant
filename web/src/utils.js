export function formatPriceNumber(num, maxDecimals = 8, zeroThreshold = 3) {
    if (num >= 1 || num === 0) {
        return num.toLocaleString(undefined, { 
            maximumFractionDigits: maxDecimals,
            minimumFractionDigits: 0,
        })
    }
    
    const str = num.toFixed(20)
    const match = str.match(/^0\.(0+)([1-9]\d*)/)
    
    if (match && match[1].length >= zeroThreshold) {
        const zeros = match[1].length
        let digits = match[2].substring(0, maxDecimals)
        // 去掉后导零
        digits = digits.replace(/0+$/, '')
        return `0.0{${zeros}}${digits}`
    }
    
    // 对于普通小数，使用 toLocaleString（会自动去掉后导零）
    return num.toLocaleString(undefined, { 
        maximumFractionDigits: maxDecimals,
        minimumFractionDigits: 0,
    })
}
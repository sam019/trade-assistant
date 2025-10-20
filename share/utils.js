export function getPrecisionLength(decimal) {
    return (Number(decimal) + 1).toString().split('.')[1]?.length || 0
}
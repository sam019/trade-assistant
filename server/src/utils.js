import os from 'os'

export function getLocalIpAddress() {
    const networkInterfaces = os.networkInterfaces()
    let localIpAddress = null

    for (const interfaceName in networkInterfaces) {
        const networkInterface = networkInterfaces[interfaceName]
        for (const details of networkInterface) {
            // Look for an IPv4 address that is not internal (loopback)
            if (details.family === 'IPv4' && !details.internal) {
                localIpAddress = details.address
                break // Found the address, no need to check further
            }
        }
        if (localIpAddress) {
            break // Found the address, no need to check other interfaces
        }
    }
    return localIpAddress
}
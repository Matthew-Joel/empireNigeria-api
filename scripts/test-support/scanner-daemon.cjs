/* Deterministic ClamD protocol fixture. It does not run an antivirus engine. */
const { createServer } = require('node:net')

async function createScannerFixture() {
  const sockets = new Set()
  const fixture = { mode: 'clean', scans: 0 }
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(15_000, () => socket.destroy())
    let buffer = Buffer.alloc(0)
    let commandRead = false
    let total = 0
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!commandRead) {
        const end = buffer.indexOf(0)
        if (end < 0) return
        if (buffer.subarray(0, end).toString() !== 'zINSTREAM') return socket.destroy()
        buffer = buffer.subarray(end + 1)
        commandRead = true
      }
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0)
        if (length > 5_000_000 || total + length > 5_000_000) return socket.destroy()
        if (buffer.length < 4 + length) return
        buffer = buffer.subarray(4 + length)
        total += length
        if (length === 0) {
          fixture.scans += 1
          if (fixture.mode === 'disconnect') return socket.destroy()
          const reply = fixture.mode === 'infected' ? 'stream: Test-Signature FOUND' : fixture.mode === 'error' ? 'stream: scan failed ERROR' : 'stream: OK'
          socket.end(reply + '\0')
          return
        }
      }
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  fixture.host = '127.0.0.1'
  fixture.port = String(server.address().port)
  fixture.close = async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
  return fixture
}

module.exports = { createScannerFixture }

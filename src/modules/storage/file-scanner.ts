import { connect } from 'node:net'

/** Scan a complete, size-limited upload through clamd's framed INSTREAM protocol. */
export function scanWithClamd(bytes: Buffer, host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    let reply = ''
    let settled = false
    const finish = (error?: Error, result?: string) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.destroy()
      if (error) reject(error)
      else resolve(result!)
    }
    const fail = (error: Error) => finish(error)
    // An absolute deadline also bounds a peer that keeps sending partial replies.
    const deadline = setTimeout(() => fail(new Error('Scanner timed out')), 15_000)
    socket.on('error', fail)
    socket.on('connect', () => {
      const length = Buffer.alloc(4)
      length.writeUInt32BE(bytes.length)
      socket.write(Buffer.from('zINSTREAM\0'))
      socket.write(length)
      socket.write(bytes)
      socket.write(Buffer.alloc(4))
    })
    socket.on('data', (chunk: Buffer) => {
      reply += chunk.toString('utf8')
      if (reply.length > 4096) return fail(new Error('Scanner reply too large'))
      if (reply.includes('\0')) finish(undefined, reply.split('\0')[0])
    })
    socket.on('end', () => fail(new Error('Scanner closed without a result')))
    socket.on('close', () => fail(new Error('Scanner closed without a result')))
  })
}

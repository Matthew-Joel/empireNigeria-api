import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import { createServer, type AddressInfo } from 'node:net'
import { scanWithClamd } from './file-scanner'

describe('clamd upload scanning', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('streams the complete upload with length framing and waits for an OK reply', async () => {
    const payload = Buffer.from('small test upload')
    let received = Buffer.alloc(0)
    const command = Buffer.from('zINSTREAM\0')
    const server = createServer((socket) => {
      socket.on('data', (chunk) => {
        received = Buffer.concat([received, chunk])
        if (received.length >= command.length + 4 + payload.length + 4) socket.end('stream: OK\0')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      await expect(scanWithClamd(payload, '127.0.0.1', port)).resolves.toBe('stream: OK')
      expect(received.subarray(0, command.length)).toEqual(command)
      expect(received.readUInt32BE(command.length)).toBe(payload.length)
      expect(received.subarray(command.length + 4, command.length + 4 + payload.length)).toEqual(payload)
      expect(received.readUInt32BE(received.length - 4)).toBe(0)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it('collects a fragmented NUL-terminated result and closes the scanner socket', async () => {
    const socket = new EventEmitter() as net.Socket
    socket.destroy = jest.fn().mockReturnValue(socket)
    jest.spyOn(net, 'connect').mockReturnValue(socket)
    const scan = scanWithClamd(Buffer.from('test'), 'scanner', 3310)
    socket.emit('data', Buffer.from('stream: '))
    socket.emit('data', Buffer.from('OK\0'))
    await expect(scan).resolves.toBe('stream: OK')
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it('rejects a socket error and destroys the scanner connection', async () => {
    const socket = new EventEmitter() as net.Socket
    socket.destroy = jest.fn().mockReturnValue(socket)
    jest.spyOn(net, 'connect').mockReturnValue(socket)
    const scan = scanWithClamd(Buffer.from('test'), 'scanner', 3310)
    const rejection = expect(scan).rejects.toThrow('connection refused')
    socket.emit('error', new Error('connection refused'))
    await rejection
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it.each(['end', 'close'])('rejects a scanner that emits %s before a complete reply', async (event) => {
    const socket = new EventEmitter() as net.Socket
    socket.destroy = jest.fn().mockReturnValue(socket)
    jest.spyOn(net, 'connect').mockReturnValue(socket)
    const scan = scanWithClamd(Buffer.from('test'), 'scanner', 3310)
    const rejection = expect(scan).rejects.toThrow('Scanner closed without a result')
    socket.emit('data', Buffer.from('stream: OK'))
    socket.emit(event)
    await rejection
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized scanner replies', async () => {
    const socket = new EventEmitter() as net.Socket
    socket.destroy = jest.fn().mockReturnValue(socket)
    jest.spyOn(net, 'connect').mockReturnValue(socket)
    const scan = scanWithClamd(Buffer.from('test'), 'scanner', 3310)
    const rejection = expect(scan).rejects.toThrow('Scanner reply too large')
    socket.emit('data', Buffer.alloc(4097, 'a'))
    await rejection
  })

  it('enforces an absolute deadline even if the scanner sends a partial reply', async () => {
    jest.useFakeTimers()
    const socket = new EventEmitter() as net.Socket
    socket.destroy = jest.fn().mockReturnValue(socket)
    jest.spyOn(net, 'connect').mockReturnValue(socket)
    const scan = scanWithClamd(Buffer.from('test'), 'scanner', 3310)
    const rejection = expect(scan).rejects.toThrow('Scanner timed out')
    jest.advanceTimersByTime(14_000)
    socket.emit('data', Buffer.from('stream: '))
    jest.advanceTimersByTime(1_000)
    await rejection
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })
})

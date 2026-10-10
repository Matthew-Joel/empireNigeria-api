import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SupabaseStorageService } from './supabase-storage.service'

function service(legacy = false, settings: Record<string, string> = {}) {
  const values: Record<string, string> = { SUPABASE_URL: 'https://project.supabase.co', [legacy ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_SECRET_KEY']: legacy ? 'legacy-key' : 'sb_secret_private-key', SUPABASE_STORAGE_BUCKET: 'property-files', ...settings }
  return new SupabaseStorageService({ get: (key: string) => values[key] } as ConfigService)
}

describe('SupabaseStorageService', () => {
  afterEach(() => jest.restoreAllMocks())

  it('uses the private service key only for signing and returns a token URL', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ url: '/object/upload/sign/property-files/pending/test?token=upload-token' }) } as Response)
    const url = await service().signUpload('pending/test')
    expect(url).toBe('https://project.supabase.co/storage/v1/object/upload/sign/property-files/pending/test?token=upload-token')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/object/upload/sign/property-files/pending/test'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ apikey: 'sb_secret_private-key' }) }))
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(url).not.toContain('sb_secret_private-key')
  })

  it('keeps the bearer header for a legacy service-role key', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ url: '/object/upload/sign/property-files/pending/test?token=upload-token' }) } as Response)
    await service(true).signUpload('pending/test')
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ apikey: 'legacy-key', Authorization: 'Bearer legacy-key' }) }))
  })

  it('sets a one-minute signed download and attachment flag for documents', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ signedURL: '/object/sign/property-files/properties/test?token=download-token' }) } as Response)
    const url = await service().signedDownload('properties/test', true)
    expect(url).toContain('download=')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/object/sign/property-files/properties/test'), expect.objectContaining({ body: JSON.stringify({ expiresIn: 60 }) }))
  })

  it('preserves the byte limit when the storage object has no content-length header', async () => {
    const cancel = jest.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
      },
      cancel,
    })
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(stream))
    await expect(service().download('pending/test', 3)).rejects.toThrow(BadRequestException)
    expect(cancel).toHaveBeenCalled()
  })

  it('accepts the exact 5,000,000-byte maximum', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(5_000_000)))
    const bytes = await service().download('pending/test', 5_000_000)
    expect(bytes.length).toBe(5_000_000)
  })

  it.each([0, -1, 1.5, 5_000_001])('rejects invalid declared byte size %s before downloading', async (size) => {
    const fetchMock = jest.spyOn(global, 'fetch')
    await expect(service().download('pending/test', size)).rejects.toThrow(BadRequestException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports interrupted download streams without exposing provider details', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('provider-private-detail')) } })
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(stream))
    await expect(service().download('pending/test', 10)).rejects.toThrow('Could not read uploaded file')
  })
})

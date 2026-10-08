import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { scanWithClamd } from './file-scanner'

@Injectable()
export class SupabaseStorageService {
  readonly propertyBucket: string
  readonly profileBucket: string

  constructor(private readonly config: ConfigService) {
    this.propertyBucket = config.get<string>('SUPABASE_STORAGE_BUCKET') || 'property-files'
    this.profileBucket = config.get<string>('SUPABASE_PROFILE_BUCKET') || 'profile-images'
  }

  private settings() {
    const projectUrl = this.config.get<string>('SUPABASE_URL')
    const secretKey = this.config.get<string>('SUPABASE_SECRET_KEY')
    const legacyKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')
    const key = secretKey || legacyKey
    if (!projectUrl || !key) throw new ServiceUnavailableException('Storage is not configured')
    return { base: `${projectUrl.replace(/\/$/, '')}/storage/v1`, key, legacy: !secretKey }
  }

  private path(objectKey: string, bucket: string) {
    return `${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  }

  private async call(route: string, method: string, body?: object) {
    const { base, key, legacy } = this.settings()
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { apikey: key, ...(legacy ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    }).catch(() => { throw new ServiceUnavailableException('Storage is unavailable') })
    if (!response.ok) throw new ServiceUnavailableException(`Storage request failed (${response.status})`)
    return response
  }

  async signUpload(path: string, bucket = this.propertyBucket) {
    const { base } = this.settings()
    const response = await this.call(`/object/upload/sign/${this.path(path, bucket)}`, 'POST', {})
    const data = await response.json() as { url?: string }
    if (!data.url) throw new ServiceUnavailableException('Could not prepare storage upload')
    return new URL(`${base}${data.url}`).toString()
  }

  async download(path: string, maxBytes: number, bucket = this.propertyBucket) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 5_000_000) throw new BadRequestException('Upload size must be between 1 byte and 5 MB')
    const response = await this.call(`/object/${this.path(path, bucket)}`, 'GET')
    const reader = response.body?.getReader()
    if (!reader) throw new ServiceUnavailableException('Could not read uploaded file')
    const chunks: Buffer[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) throw new BadRequestException('Uploaded file exceeds its declared size')
        chunks.push(Buffer.from(value))
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      if (error instanceof BadRequestException) throw error
      throw new ServiceUnavailableException('Could not read uploaded file')
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks)
  }

  async move(from: string, to: string, bucket = this.propertyBucket) {
    await this.call('/object/move', 'POST', { bucketId: bucket, sourceKey: from, destinationKey: to })
  }

  async signedDownload(path: string, download: boolean, bucket = this.propertyBucket) {
    const { base } = this.settings()
    const response = await this.call(`/object/sign/${this.path(path, bucket)}`, 'POST', { expiresIn: 60 })
    const data = await response.json() as { signedURL?: string; signedUrl?: string }
    const relative = data.signedURL || data.signedUrl
    if (!relative) throw new ServiceUnavailableException('Could not prepare file access')
    const url = new URL(`${base}${relative}`)
    if (download) url.searchParams.set('download', '')
    return url.toString()
  }

  async remove(path: string, bucket = this.propertyBucket) {
    await this.call(`/object/${encodeURIComponent(bucket)}`, 'DELETE', { prefixes: [path] })
  }

  async scan(bytes: Buffer) {
    const host = this.config.get<string>('CLAMAV_HOST')?.trim()
    const required = this.config.get<string>('FILE_SCAN_REQUIRED') === 'true' || this.config.get<string>('NODE_ENV') === 'production'
    if (!host) {
      if (required) throw new ServiceUnavailableException('File scanner is not configured')
      return
    }
    const port = Number(this.config.get<string>('CLAMAV_PORT') || '3310')
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ServiceUnavailableException('File scanner port is invalid')
    let result: string
    try { result = await scanWithClamd(bytes, host, port) }
    catch { throw new ServiceUnavailableException('File scanner is unavailable') }
    if (/^stream: .+ FOUND$/.test(result)) throw new BadRequestException('Uploaded file failed malware scanning')
    if (result !== 'stream: OK') throw new ServiceUnavailableException('File scanner could not verify this upload')
  }
}

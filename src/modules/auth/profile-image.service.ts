import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../database/prisma.service'
import { fileSignature } from '../storage/file-signature'
import { SupabaseStorageService } from '../storage/supabase-storage.service'
import { StartProfileImageUploadDto } from './dto/profile-image.dto'

const uploadLifetime = 2 * 60 * 60 * 1000

@Injectable()
export class ProfileImageService {
  private readonly logger = new Logger(ProfileImageService.name)

  constructor(private readonly prisma: PrismaService, private readonly storage: SupabaseStorageService) {}

  async start(userId: string, dto: StartProfileImageUploadDto) {
    const pending = await this.prisma.profileImageUpload.count({ where: { userId, createdAt: { gt: new Date(Date.now() - uploadLifetime) } } })
    if (pending >= 5) throw new BadRequestException('Too many uploads in progress')
    const objectKey = `pending/profiles/${userId}/${randomUUID()}`
    const record = await this.prisma.profileImageUpload.create({ data: { userId, objectKey, contentType: dto.contentType, sizeBytes: dto.sizeBytes } })
    try {
      return { id: record.id, uploadUrl: await this.storage.signUpload(objectKey, this.storage.profileBucket), expiresInSeconds: 7200 }
    } catch (error) {
      await this.prisma.profileImageUpload.delete({ where: { id: record.id } })
      throw error
    }
  }

  async complete(userId: string, uploadId: string) {
    const previousKey = await this.prisma.$transaction(async (tx) => {
      // Serialize replacements for one profile before locking its individual upload.
      await tx.$queryRaw`SELECT "userId" FROM "user_profiles" WHERE "userId" = ${userId}::uuid FOR UPDATE`
      const old = await tx.userProfile.findUnique({ where: { userId }, select: { avatarObjectKey: true } })
      if (!old) throw new NotFoundException('Profile not found')
      await tx.$queryRaw`SELECT "id" FROM "profile_image_uploads" WHERE "id" = ${uploadId}::uuid FOR UPDATE`
      const record = await tx.profileImageUpload.findFirst({ where: { id: uploadId, userId } })
      if (!record) throw new NotFoundException('Profile image upload not found')
      if (Date.now() - record.createdAt.getTime() > uploadLifetime) throw new BadRequestException('Upload expired')
      const bytes = await this.storage.download(record.objectKey, record.sizeBytes, this.storage.profileBucket)
      if (bytes.length !== record.sizeBytes || fileSignature(bytes) !== record.contentType) throw new BadRequestException('Uploaded image does not match its declared type or size')
      const readyKey = `profiles/${userId}/${record.id}`
      await this.storage.move(record.objectKey, readyKey, this.storage.profileBucket)
      try {
        await tx.userProfile.update({ where: { userId }, data: { avatarObjectKey: readyKey } })
        await tx.profileImageUpload.delete({ where: { id: record.id } })
      } catch (error) {
        // The transaction will roll back; restore the pending object for a safe retry.
        await this.storage.move(readyKey, record.objectKey, this.storage.profileBucket).catch(() => this.logger.warn('Could not restore pending profile image'))
        throw error
      }
      return old.avatarObjectKey
    }, { maxWait: 5_000, timeout: 90_000 })
    if (previousKey && previousKey !== `profiles/${userId}/${uploadId}`) await this.storage.remove(previousKey, this.storage.profileBucket).catch(() => this.logger.warn('Could not remove replaced profile image'))
    return this.get(userId)
  }

  async get(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId }, select: { avatarObjectKey: true } })
    if (!profile?.avatarObjectKey) return { url: null }
    return { url: await this.storage.signedDownload(profile.avatarObjectKey, false, this.storage.profileBucket), expiresInSeconds: 60 }
  }

  async remove(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId }, select: { avatarObjectKey: true } })
    if (!profile?.avatarObjectKey) return { deleted: true }
    await this.prisma.userProfile.update({ where: { userId }, data: { avatarObjectKey: null } })
    await this.storage.remove(profile.avatarObjectKey, this.storage.profileBucket).catch(() => this.logger.warn('Could not remove profile image'))
    return { deleted: true }
  }
}

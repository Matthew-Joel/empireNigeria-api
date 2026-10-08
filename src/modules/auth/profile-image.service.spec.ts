import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ProfileImageService } from './profile-image.service'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])

function setup() {
  const profile = { avatarObjectKey: 'profiles/user/old' }
  const record = { id: 'upload-id', userId: 'user', objectKey: 'pending/profiles/user/new', contentType: 'image/png', sizeBytes: png.length, createdAt: new Date() }
  const transaction = jest.fn()
  const prisma = {
    profileImageUpload: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue(record), findFirst: jest.fn().mockResolvedValue(record), delete: jest.fn().mockResolvedValue(record) },
    userProfile: { findUnique: jest.fn().mockResolvedValue(profile), update: jest.fn().mockResolvedValue(profile) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: transaction,
  }
  transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
  const storage = { profileBucket: 'profile-images', signUpload: jest.fn().mockResolvedValue('https://example/upload'), download: jest.fn().mockResolvedValue(png), scan: jest.fn(), move: jest.fn().mockResolvedValue(undefined), signedDownload: jest.fn().mockResolvedValue('https://example/image'), remove: jest.fn().mockResolvedValue(undefined) }
  return { service: new ProfileImageService(prisma as never, storage as never), prisma, storage, record }
}

describe('ProfileImageService', () => {
  it('scopes completion to the signed-in user', async () => {
    const { service, prisma } = setup()
    prisma.profileImageUpload.findFirst.mockResolvedValue(null)
    await expect(service.complete('other-user', 'upload-id')).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.profileImageUpload.findFirst).toHaveBeenCalledWith({ where: { id: 'upload-id', userId: 'other-user' } })
  })

  it('keeps the old image when uploaded bytes do not match', async () => {
    const { service, prisma, storage } = setup()
    storage.download.mockResolvedValue(Buffer.from('not an image'))
    await expect(service.complete('user', 'upload-id')).rejects.toBeInstanceOf(BadRequestException)
    expect(storage.move).not.toHaveBeenCalled()
    expect(prisma.userProfile.update).not.toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('publishes a verified image, then deletes the replaced object', async () => {
    const { service, prisma, storage } = setup()
    await expect(service.complete('user', 'upload-id')).resolves.toEqual({ url: 'https://example/image', expiresInSeconds: 60 })
    expect(storage.move).toHaveBeenCalledWith('pending/profiles/user/new', 'profiles/user/upload-id', 'profile-images')
    expect(prisma.userProfile.update).toHaveBeenCalledWith({ where: { userId: 'user' }, data: { avatarObjectKey: 'profiles/user/upload-id' } })
    expect(storage.remove).toHaveBeenCalledWith('profiles/user/old', 'profile-images')
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('preserves the previous image and pending record when scanning rejects the upload', async () => {
    const { service, prisma, storage } = setup()
    storage.scan.mockRejectedValue(new BadRequestException('Uploaded file failed malware scanning'))
    await expect(service.complete('user', 'upload-id')).rejects.toThrow('Uploaded file failed malware scanning')
    expect(storage.move).not.toHaveBeenCalled()
    expect(prisma.userProfile.update).not.toHaveBeenCalled()
    expect(prisma.profileImageUpload.delete).not.toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('restores the pending image if the database update fails before commit', async () => {
    const { service, prisma, storage } = setup()
    prisma.userProfile.update.mockRejectedValue(new Error('Database write failed'))
    await expect(service.complete('user', 'upload-id')).rejects.toThrow('Database write failed')
    expect(storage.move).toHaveBeenLastCalledWith('profiles/user/upload-id', 'pending/profiles/user/new', 'profile-images')
    expect(storage.remove).not.toHaveBeenCalled()
  })
})

import { PrismaClient, UserRole, UserStatus } from '@prisma/client'
import * as argon2 from 'argon2'

const prisma = new PrismaClient()

async function main() {
  const seedPassword = process.env.SEED_PASSWORD
  if (!seedPassword) {
    throw new Error('Set SEED_PASSWORD before creating the internal administrator')
  }
  const passwordHash = await argon2.hash(seedPassword)

  await prisma.user.upsert({
    where: { email: 'admin@empirenigeria.com' },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: 'admin@empirenigeria.com',
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          firstName: 'Empire',
          lastName: 'Administrator',
        },
      },
    },
  })

  console.log('Admin account seeded: admin@empirenigeria.com')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

/* Run after building the API. The deployment worker runs this every six hours. */
require('reflect-metadata')
const { parseCleanupOptions, cleanupExpiredUploads } = require('./lib/expired-upload-cleanup.cjs')

async function main() {
  const options = parseCleanupOptions(process.argv.slice(2))
  const { PrismaClient } = require('@prisma/client')
  const { ConfigService } = require('@nestjs/config')
  const { SupabaseStorageService } = require('../dist/modules/storage/supabase-storage.service')
  const prisma = new PrismaClient()
  try {
    const storage = new SupabaseStorageService(new ConfigService(process.env))
    const summary = await cleanupExpiredUploads({ prisma, storage, options })
    console.log(JSON.stringify(summary))
    if (summary.totals.failed) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) main().catch(() => {
  console.error('Pending upload cleanup failed. Check database/storage availability and command arguments; no credentials are logged.')
  process.exitCode = 1
})

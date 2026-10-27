import { writeFileSync } from 'node:fs'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'
import { buildOpenApiDocument } from './openapi'

// Writes the contract to docs/openapi.json without connecting to the database or listening on a port.
async function exportOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] })
  configureApp(app)
  const output = process.argv[2] ?? 'docs/openapi.json'
  writeFileSync(output, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`)
  await app.close()
  console.log(`OpenAPI spec written to ${output}`)
}

void exportOpenApi()

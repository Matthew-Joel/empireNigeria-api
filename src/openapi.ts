import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INestApplication } from '@nestjs/common'
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger'

// Resolves to the project root from both src/ and dist/.
const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
const ERROR_REF = { $ref: '#/components/schemas/ErrorResponse' }

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('empireNigeria API')
    .setDescription([
      'Property management API for owners, managers, inspectors, contractors, guests and administrators.',
      '',
      'Authenticate with `POST /api/v1/auth/login`, then send the `accessToken` as `Authorization: Bearer <token>`.',
      'Access tokens are short-lived; exchange the refresh token at `POST /api/v1/auth/refresh`.',
      'Each operation lists the roles allowed to call it under `x-roles`; other authenticated roles receive 403.',
      'Request bodies are strictly validated: unknown properties are rejected with 400.',
    ].join('\n'))
    .setVersion(version)
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)
  addStandardResponses(document)
  return document
}

export function setupOpenApi(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    yamlDocumentUrl: 'api/docs-yaml',
  })
}

/** Documents the error contract that guards, pipes and services share, derived from each operation's metadata. */
function addStandardResponses(document: OpenAPIObject) {
  document.components ??= {}
  document.components.schemas = {
    ...document.components.schemas,
    ErrorResponse: {
      type: 'object',
      required: ['statusCode', 'message'],
      properties: {
        statusCode: { type: 'integer', example: 400 },
        message: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Validation failures return one message per invalid field.',
        },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  }

  for (const pathItem of Object.values(document.paths)) {
    for (const method of METHODS) {
      const operation = pathItem[method]
      if (operation) describeOperation(operation)
    }
  }
}

function describeOperation(operation: Operation) {
  const add = (status: string, description: string) => {
    operation.responses[status] ??= { description, content: { 'application/json': { schema: ERROR_REF } } }
  }
  const params = operation.parameters?.filter((param) => 'in' in param) ?? []
  const pathParams = params.filter((param) => param.in === 'path')
  const roles = (operation as unknown as { 'x-roles'?: string[] })['x-roles']

  // Every route parameter in this API is parsed with ParseUUIDPipe.
  for (const param of pathParams) param.schema = { type: 'string', format: 'uuid' }

  if (operation.requestBody || params.length) add('400', 'Validation failed')
  if (operation.security?.length) add('401', 'Missing, invalid or expired access token')
  if (roles?.length) {
    add('403', `Requires one of: ${roles.join(', ')}`)
    operation.description = [`**Roles:** ${roles.join(', ')}`, operation.description].filter(Boolean).join('\n\n')
  }
  if (pathParams.length) add('404', 'Resource not found or not visible to the caller')
}

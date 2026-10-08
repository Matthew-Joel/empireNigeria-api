import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService)
  const origins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((origin) => origin.trim()).filter(Boolean)
  app.setGlobalPrefix('api/v1')
  app.enableCors({ origin: origins, credentials: true })
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
}

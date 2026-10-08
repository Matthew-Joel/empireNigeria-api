import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)
  configureApp(app)

  const port = Number(config.get<string>('PORT') ?? 4000)
  await app.listen(port)
}

void bootstrap()

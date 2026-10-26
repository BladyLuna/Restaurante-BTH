import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { corsOptions } from './cors.js';
import { AppModule } from './app.module.js';
import { configurarBodyParser } from './http-config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // LAN explícita vía CORS_ORIGINS; nunca reflejar cualquier origen.
  app.enableCors(corsOptions());

  // El logo del local llega como base64 en JSON y no entra en el límite de
  // 100 kB que trae express por defecto (http-config.ts explica por qué).
  configurarBodyParser(app);

  // Confía en X-Forwarded-For si alguna vez hay un proxy delante. Importa para
  // que el rate limit vea la IP real del dispositivo y no la del proxy.
  app.set('trust proxy', true);

  const puerto = Number(process.env['PORT'] ?? 3000);
  await app.listen(puerto);
  console.log(`API escuchando en http://localhost:${puerto}`);
}

void bootstrap();

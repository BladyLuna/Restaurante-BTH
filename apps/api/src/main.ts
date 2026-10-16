import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // El servidor vive en la LAN del local (PLAN §3). CORS abierto a la red
  // local: el kiosco, el KDS y el panel son origenes distintos del mismo WiFi.
  app.enableCors({ origin: true, credentials: true });

  // Confía en X-Forwarded-For si alguna vez hay un proxy delante. Importa para
  // que el rate limit vea la IP real del dispositivo y no la del proxy.
  app.set('trust proxy', true);

  const puerto = Number(process.env['PORT'] ?? 3000);
  await app.listen(puerto);
  console.log(`API escuchando en http://localhost:${puerto}`);
}

void bootstrap();

import 'reflect-metadata';
import { expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import request from 'supertest';
import { corsOptions } from './cors.js';
@Module({})
class EmptyModule {}
it('CORS solo permite orígenes exactos configurados y localhost en desarrollo', async () => {
  const app = await NestFactory.create(EmptyModule, { logger: false });
  app.enableCors(corsOptions({ NODE_ENV: 'development', CORS_ORIGINS: 'http://192.168.1.20:8081' }));
  await app.init();
  try {
    for (const origin of ['http://localhost:8081', 'http://192.168.1.20:8081']) {
      const res = await request(app.getHttpServer()).options('/kitchen/orders')
        .set('Origin', origin).set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    }
    for (const origin of ['https://evil.example', 'http://192.168.1.21:8081', 'http://localhost.evil.example:8081', 'null']) {
      const res = await request(app.getHttpServer()).options('/kitchen/orders').set('Origin', origin)
        .set('Access-Control-Request-Method', 'PATCH');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  } finally { await app.close(); }
});
it('producción no admite localhost implícito ni wildcard', () => {
  expect(corsOptions({ NODE_ENV: 'production' }).origin).toEqual([]);
  expect(() => corsOptions({ NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow();
  expect(() => corsOptions({ CORS_ORIGINS: 'http://host/path' })).toThrow();
});

/**
 * B5 — branding del local (nombre + logo)
 *
 * Tests HTTP reales contra PostgreSQL, igual que kitchen/payments.
 *
 * Qué se prueba acá y por qué:
 *   - El kiosco lee el branding SIN sesión (RQ: pantalla pública).
 *   - Solo ADMIN lo modifica: la identidad del local es decisión de la dueña
 *     (PLAN §5g, misma fila que "gestionar catálogo").
 *   - Todo cambio queda auditado (PLAN §5c): CONFIGURACION_CAMBIADA.
 *   - La imagen se valida por CONTENIDO (cabecera mágica), no por lo que el
 *     cliente diga que es, y no se usa ningún nombre de archivo del cliente.
 *
 * Estos tests tocan settings GLOBALES (`local.nombre`, `local.logo`), así que
 * guardan y restauran el valor previo, igual que payments.http.test.ts hace con
 * `pedido.timeout_minutos`.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Prisma, Rol } from '@prisma/client';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../infra/prisma.service.js';
import { configurarBodyParser } from '../http-config.js';
import { CLAVE_LOGO, CLAVE_NOMBRE } from './settings.service.js';

const loc = `test-settings-${randomUUID()}`;
let app: NestExpressApplication;
let db: PrismaService;
const tokens = {} as Record<Rol, string>;
const users = {} as Record<Rol, string>;
const previos = new Map<string, Prisma.JsonValue>();

/** PNG mínimo: firma de 8 bytes + relleno. La validación mira la firma. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('logo-de-prueba-png'),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('logo-de-prueba-jpeg'),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('VP8 relleno'),
]);

const publicGet = () => request(app.getHttpServer()).get('/settings/branding');
const put = (body: unknown, rol: Rol | null = 'ADMIN') => {
  const r = request(app.getHttpServer()).put('/admin/settings/branding');
  if (rol !== null) r.auth(tokens[rol], { type: 'bearer' });
  return r.send(body as object);
};

beforeAll(async () => {
  process.env['JWT_SECRET'] = randomUUID();
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication<NestExpressApplication>();
  // El mismo body parser que usa main.ts: un logo de 2 MB en base64 no entra
  // en el límite de 100 kB que trae express por defecto. Si el test usara otro
  // límite que producción, estaría probando otra aplicación.
  configurarBodyParser(app);
  await app.init();
  db = app.get(PrismaService);
  await db.location.create({ data: { id: loc, nombre: 'TEST settings' } });
  const jwt = app.get(JwtService);
  for (const rol of ['ADMIN', 'CAJA', 'COCINA'] as const) {
    const user = await db.user.create({
      data: { locationId: loc, nombre: rol, rol, pinHash: 'not-a-login-hash' },
    });
    users[rol] = user.id;
    tokens[rol] = jwt.sign({ sub: user.id, rol, nombre: rol, locationId: loc });
  }
  for (const clave of [CLAVE_NOMBRE, CLAVE_LOGO]) {
    const fila = await db.setting.findUnique({ where: { clave } });
    if (fila !== null) previos.set(clave, fila.valor);
  }
});

async function limpiar(): Promise<void> {
  await db.auditLog.deleteMany({ where: { userId: { in: Object.values(users) } } });
  await db.setting.deleteMany({ where: { clave: { in: [CLAVE_NOMBRE, CLAVE_LOGO] } } });
}
beforeEach(limpiar);

afterAll(async () => {
  if (db) {
    await limpiar();
    for (const [clave, valor] of previos) {
      await db.setting.create({ data: { clave, valor: valor as Prisma.InputJsonValue } });
    }
    await db.user.deleteMany({ where: { locationId: loc } });
    await db.location.delete({ where: { id: loc } });
  }
  await app?.close();
});

it('el kiosco lee el branding sin sesión; sin logo cargado logoUrl es null', async () => {
  const r = await publicGet().expect(200);
  expect(r.body).toMatchObject({ nombreLocal: expect.any(String), logoUrl: null });
  // La imagen todavía no existe: no se inventa un placeholder.
  await request(app.getHttpServer()).get('/settings/branding/logo').expect(404);
});

it('solo ADMIN modifica el branding: 401 sin sesión, 403 para CAJA y COCINA', async () => {
  await put({ nombreLocal: 'Pollos Doña Marta' }, null).expect(401);
  await put({ nombreLocal: 'Pollos Doña Marta' }, 'CAJA').expect(403);
  await put({ nombreLocal: 'Pollos Doña Marta' }, 'COCINA').expect(403);
  await put({ nombreLocal: 'Pollos Doña Marta' }, 'ADMIN').expect(200);
  expect((await publicGet().expect(200)).body.nombreLocal).toBe('Pollos Doña Marta');
});

it('ADMIN sube el logo, se sirve por HTTP público y el cambio queda auditado', async () => {
  const r = await put({
    nombreLocal: 'Pollos Doña Marta',
    logo: { mime: 'image/png', base64: PNG.toString('base64') },
  }).expect(200);

  // Ruta relativa que empieza con '/': el frontend hace API_URL + uri, igual
  // que con imagenUrl / qrImagenUrl.
  expect(r.body.logoUrl).toMatch(/^\/settings\/branding\/logo\?v=[a-f0-9]+$/);
  expect((await publicGet()).body).toEqual(r.body);

  const img = await request(app.getHttpServer()).get(r.body.logoUrl).expect(200);
  expect(img.headers['content-type']).toContain('image/png');
  expect(Buffer.from(img.body)).toEqual(PNG);

  const logs = await db.auditLog.findMany({ where: { userId: users.ADMIN } });
  expect(logs).toMatchObject([
    {
      accion: 'CONFIGURACION_CAMBIADA',
      userId: users.ADMIN,
      detalle: expect.objectContaining({
        campos: ['nombreLocal', 'logo'],
        nombreLocal: { anterior: null, nuevo: 'Pollos Doña Marta' },
      }),
    },
  ]);
  // El log guarda metadatos, nunca la imagen entera.
  expect(JSON.stringify(logs[0]?.detalle).length).toBeLessThan(1000);
});

it('cambiar solo el logo no borra el nombre, y la URL cambia de versión', async () => {
  await put({ nombreLocal: 'Pollos Doña Marta' }).expect(200);
  const uno = await put({ logo: { mime: 'image/png', base64: PNG.toString('base64') } }).expect(200);
  const dos = await put({ logo: { mime: 'image/webp', base64: WEBP.toString('base64') } }).expect(200);
  expect(dos.body.nombreLocal).toBe('Pollos Doña Marta');
  expect(dos.body.logoUrl).not.toBe(uno.body.logoUrl);
  const img = await request(app.getHttpServer()).get(dos.body.logoUrl).expect(200);
  expect(img.headers['content-type']).toContain('image/webp');
});

it('logo: null quita el logo sin tocar el nombre', async () => {
  await put({
    nombreLocal: 'Pollos Doña Marta',
    logo: { mime: 'image/jpeg', base64: JPEG.toString('base64') },
  }).expect(200);
  const r = await put({ logo: null }).expect(200);
  expect(r.body).toEqual({ nombreLocal: 'Pollos Doña Marta', logoUrl: null });
  await request(app.getHttpServer()).get('/settings/branding/logo').expect(404);
  expect(await db.auditLog.count({ where: { userId: users.ADMIN } })).toBe(2);
});

it('valida el CONTENIDO del archivo, no lo que dice el cliente', async () => {
  // mime no permitido
  await put({ logo: { mime: 'image/gif', base64: PNG.toString('base64') } }).expect(400);
  await put({ logo: { mime: 'application/pdf', base64: PNG.toString('base64') } }).expect(400);
  // dice png, manda jpeg: la cabecera mágica no coincide
  await put({ logo: { mime: 'image/png', base64: JPEG.toString('base64') } }).expect(400);
  // no es una imagen en absoluto
  await put({ logo: { mime: 'image/png', base64: Buffer.from('<?php echo 1; ?>').toString('base64') } }).expect(400);
  // base64 inválido
  await put({ logo: { mime: 'image/png', base64: 'no-es-base64-%%%' } }).expect(400);
  // nada que cambiar
  await put({}).expect(400);
  await put({ nombreLocal: '   ' }).expect(400);
  // el nombre de archivo del cliente no se acepta ni se usa (path traversal)
  await put({
    logo: {
      mime: 'image/png',
      base64: PNG.toString('base64'),
      nombreArchivo: '../../../etc/passwd',
    },
  }).expect(400);
  await put({ nombreLocal: 'Ok', ruta: '/tmp/x' }).expect(400);
  expect(await db.setting.count({ where: { clave: { in: [CLAVE_NOMBRE, CLAVE_LOGO] } } })).toBe(0);
});

it('rechaza una imagen más grande que el límite con 413', async () => {
  const grande = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(2 * 1024 * 1024 + 1024, 7),
  ]);
  await put({ logo: { mime: 'image/png', base64: grande.toString('base64') } }).expect(413);
  expect(await db.setting.findUnique({ where: { clave: CLAVE_LOGO } })).toBeNull();
});

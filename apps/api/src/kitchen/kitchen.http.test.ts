import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { EstadoPedido, Rol } from '@prisma/client';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../infra/prisma.service.js';

const loc = `test-kitchen-${randomUUID()}`;
const other = `${loc}-other`;
let app: INestApplication;
let db: PrismaService;
const tokens = {} as Record<Rol, string>;
const users = {} as Record<Rol, string>;
let numero = 0;
let productId: string;
let categoryId: string;
async function pedido(estado: EstadoPedido, pagadoEn = new Date(), locationId = loc) {
  return db.order.create({ data: { locationId, numero: ++numero, fecha: new Date(),
    nombreCliente: 'Cliente', tipo: 'PARA_LLEVAR', total: 4500, subtotal: 4500,
    intentoUuid: randomUUID(), estado, pagadoEn,
    confirmadoPorId: ['PAGADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO'].includes(estado) ? users.CAJA : null,
    canceladoEn: estado === 'CANCELADO' ? new Date() : null,
    items: { create: { productId, cantidad: 1, nombreSnapshot: 'Nombre congelado', precioUnitarioSnapshot: 4500 } },
  } });
}
const get = () => request(app.getHttpServer()).get('/kitchen/orders').auth(tokens.COCINA, { type: 'bearer' });
const patch = (id: string, estado: string, rol: Rol = 'COCINA') => request(app.getHttpServer())
  .patch(`/kitchen/orders/${id}/estado`).auth(tokens[rol], { type: 'bearer' }).send({ estado });
beforeAll(async () => {
  process.env['JWT_SECRET'] = randomUUID();
  app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  await app.init(); db = app.get(PrismaService);
  await db.location.createMany({ data: [{ id: loc, nombre: 'TEST kitchen' }, { id: other, nombre: 'TEST other' }] });
  const category = await db.category.create({ data: { nombre: loc } }); categoryId = category.id;
  const product = await db.product.create({ data: { categoryId, nombre: 'Nombre actual', precioBase: 5000 } }); productId = product.id;
  for (const rol of ['COCINA', 'CAJA', 'ADMIN'] as const) {
    const user = await db.user.create({ data: { locationId: loc, nombre: rol, rol, pinHash: 'not-a-login-hash' } });
    users[rol] = user.id;
    tokens[rol] = app.get(JwtService).sign({ sub: user.id, rol, nombre: rol, locationId: loc });
  }
});
async function cleanOrders() {
  await db.auditLog.deleteMany({ where: { order: { locationId: { in: [loc, other] } } } });
  await db.order.deleteMany({ where: { locationId: { in: [loc, other] } } });
}
beforeEach(cleanOrders);
afterAll(async () => {
  if (db) {
    await cleanOrders();
    await db.product.delete({ where: { id: productId } });
    await db.category.delete({ where: { id: categoryId } });
    await db.user.deleteMany({ where: { locationId: loc } });
    await db.location.deleteMany({ where: { id: { in: [loc, other] } } });
  }
  await app?.close();
});
it('transiciones shared, permisos, aislamiento y entrega auditada una sola vez', async () => {
  const p = await pedido('PAGADO');
  await patch(p.id, 'LISTO').expect(409);
  await patch(p.id, 'CANCELADO').expect(403);
  await patch(p.id, 'EN_PREPARACION', 'ADMIN').expect(403);
  await patch(p.id, 'EN_PREPARACION', 'CAJA').expect(403);
  await patch((await pedido('PAGADO', new Date(), other)).id, 'EN_PREPARACION').expect(404);
  await patch(p.id, 'desconocido').expect(400);
  await patch(p.id, 'EN_PREPARACION').expect(200);
  await patch(p.id, 'LISTO').expect(200);
  expect((await get()).body.some((x: {id: string}) => x.id === p.id)).toBe(true);
  const results = await Promise.all([patch(p.id, 'ENTREGADO', 'CAJA'), patch(p.id, 'ENTREGADO', 'CAJA')]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await db.auditLog.findMany({ where: { orderId: p.id } })).toMatchObject([
    { accion: 'PEDIDO_ENTREGADO', userId: users.CAJA, detalle: { desde: 'LISTO', hacia: 'ENTREGADO' } },
  ]);
  expect((await get()).body.some((x: {id: string}) => x.id === p.id)).toBe(false);
  for (const rol of ['COCINA', 'ADMIN'] as const) {
    await patch((await pedido('LISTO')).id, 'ENTREGADO', rol).expect(200);
  }
});
it('cola local pagada por hora de pago, snapshots y minutos calculados', async () => {
  await pedido('PENDIENTE_PAGO'); await pedido('CANCELADO'); await pedido('ENTREGADO');
  const later = await pedido('PAGADO');
  const first = await pedido('EN_PREPARACION', new Date(Date.now() - 600_000));
  const ready = await pedido('LISTO'); await pedido('PAGADO', new Date(), other);
  const r = await get().expect(200);
  expect(r.body.map((p: { id: string }) => p.id)).toEqual([first.id, later.id, ready.id]);
  expect(r.body[0]).toMatchObject({ tipo: 'PARA_LLEVAR', nombreCliente: 'Cliente', minutosEspera: 10,
    items: [{ nombre: 'Nombre congelado', cantidad: 1, precioUnitario: 4500 }] });
  await request(app.getHttpServer()).get('/kitchen/orders').expect(401);
});

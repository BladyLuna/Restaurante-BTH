import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../infra/prisma.service.js';

const loc = `test-payments-${randomUUID()}`;
let app: INestApplication;
let db: PrismaService;
let caja: string;
let admin: string;
let cajaId: string;
let adminId: string;
let numero = 0;
const post = (path: string, body: object, token = caja) =>
  request(app.getHttpServer()).post(`/admin/payments/${path}`).auth(token, { type: 'bearer' }).send(body);
async function pedido(total = 4500, locationId = loc) {
  return db.order.create({ data: { locationId, numero: ++numero, fecha: new Date(),
    nombreCliente: 'Cliente prueba', tipo: 'COMER_AQUI', total, subtotal: total, intentoUuid: randomUUID() } });
}
beforeAll(async () => {
  process.env['JWT_SECRET'] = randomUUID();
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  await app.init();
  db = app.get(PrismaService);
  await db.location.create({ data: { id: loc, nombre: 'TEST payments' } });
  const jwt = app.get(JwtService);
  for (const rol of ['CAJA', 'ADMIN'] as const) {
    const user = await db.user.create({ data: { locationId: loc, nombre: rol, rol, pinHash: 'not-a-login-hash' } });
    const token = jwt.sign({ sub: user.id, rol, nombre: user.nombre, locationId: loc });
    if (rol === 'CAJA') { caja = token; cajaId = user.id; } else { admin = token; adminId = user.id; }
  }
});
beforeEach(async () => {
  await db.auditLog.deleteMany({ where: { order: { locationId: loc } } });
  await db.order.deleteMany({ where: { locationId: loc } });
});
afterAll(async () => {
  if (db) {
    await db.auditLog.deleteMany({ where: { order: { locationId: loc } } });
    await db.order.deleteMany({ where: { locationId: loc } });
    await db.user.deleteMany({ where: { locationId: loc } });
    await db.location.delete({ where: { id: loc } });
  }
  await app?.close();
});

it('obliga a desambiguar y audita la elección explícita', async () => {
  const a = await pedido(); const b = await pedido();
  const search = await request(app.getHttpServer()).get('/admin/payments/buscar?total=4500').auth(caja, { type: 'bearer' }).expect(200);
  expect(search.body).toMatchObject({ cantidad: 2, ambiguo: true });
  expect(search.body.pedidos[0]).toMatchObject({ id: a.id, numero: a.numero, creadoEn: expect.any(String), nombreCliente: 'Cliente prueba', items: [] });
  await post('confirmar-por-monto', { montoRecibido: 4500 }).expect(409);
  await post('confirmar', { orderId: b.id, montoRecibido: 4500 }).expect(200);
  expect(await db.order.findUnique({ where: { id: a.id } })).toMatchObject({ estado: 'PENDIENTE_PAGO' });
  expect(await db.auditLog.findFirst({ where: { orderId: b.id } })).toMatchObject({ detalle: { candidatos: 2, ambiguo: true, seleccionExplicita: true, candidatosIds: [a.id, b.id] } });
});

it('solo ADMIN acepta diferencias y las registra sin alterar total', async () => {
  const p = await pedido();
  await post('confirmar', { orderId: p.id, montoRecibido: 4400 }).expect(409);
  const dto = { orderId: p.id, montoRecibido: 4400, motivo: 'Descuento autorizado' };
  await post('confirmar-con-diferencia', dto).expect(403);
  await post('confirmar-con-diferencia', dto, admin).expect(200);
  expect(await db.order.findUnique({ where: { id: p.id } })).toMatchObject({ total: 4500, montoRecibido: 4400, confirmadoPorId: adminId });
  expect(await db.auditLog.findFirst({ where: { orderId: p.id } })).toMatchObject({ accion: 'PAGO_CONFIRMADO_CON_DIFERENCIA', montoEsperado: 4500, montoRecibido: 4400, detalle: expect.objectContaining({ motivo: dto.motivo }) });
});

it('rechaza campos de autoría/comprobante y montos inválidos', async () => {
  const p = await pedido();
  for (const extra of [{ confirmadoPorId: adminId }, { paymentProofId: 'foto' }, { locationId: loc }]) {
    await post('confirmar', { orderId: p.id, montoRecibido: 4500, ...extra }).expect(400);
  }
  for (const montoRecibido of [0, -100, 4501, 4500.5, 2147483700, '4500']) {
    await post('confirmar-por-monto', { montoRecibido }).expect(400);
  }
  await post('confirmar', { montoRecibido: 4500 }).expect(400);
  await post('confirmar-con-diferencia', { orderId: p.id, montoRecibido: 4400 }, admin).expect(400);
});

it('rechaza vencidos aun sin job usando pedido.timeout_minutos', async () => {
  const setting = await db.setting.findUnique({ where: { clave: 'pedido.timeout_minutos' } });
  try {
    await db.setting.upsert({ where: { clave: 'pedido.timeout_minutos' }, create: { clave: 'pedido.timeout_minutos', valor: 1 }, update: { valor: 1 } });
    const p = await pedido();
    await db.order.update({ where: { id: p.id }, data: { creadoEn: new Date(Date.now() - 120000) } });
    await post('confirmar', { orderId: p.id, montoRecibido: 4500 }).expect(409);
    await post('confirmar-con-diferencia', { orderId: p.id, montoRecibido: 4400, motivo: 'Pago tardío' }, admin).expect(409);
    const result = await request(app.getHttpServer()).get('/admin/payments/buscar?total=4500').auth(caja, { type: 'bearer' }).expect(200);
    expect(result.body.cantidad).toBe(0);
    expect(await db.auditLog.count({ where: { orderId: p.id } })).toBe(0);
  } finally {
    if (setting) await db.setting.update({ where: { clave: setting.clave }, data: { valor: setting.valor! } });
    else await db.setting.delete({ where: { clave: 'pedido.timeout_minutos' } });
  }
});

it('dos confirmaciones concurrentes producen un solo cobro y un solo log', async () => {
  const p = await pedido();
  const repo = app.get(PaymentsRepository);
  const real = repo.candidatos.bind(repo);
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const spy = vi.spyOn(repo, 'candidatos').mockImplementation(async (...args) => {
    const result = await real(...args);
    if (++arrived === 2) release();
    await barrier;
    return result;
  });
  try {
    const results = await Promise.all(Array.from({ length: 2 }, () => post('confirmar', { orderId: p.id, montoRecibido: 4500 })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  } finally { spy.mockRestore(); }
  expect(await db.auditLog.count({ where: { orderId: p.id } })).toBe(1);
});

it('revalida permisos dentro de la transacción aunque la sesión ya pasó el guard', async () => {
  const p = await pedido();
  const stale = { id: cajaId, rol: 'CAJA' as const, nombre: 'CAJA', locationId: loc };
  await db.user.update({ where: { id: cajaId }, data: { activo: false } });
  try {
    await expect(app.get(PaymentsService).confirmar(stale, 4500, p.id)).rejects.toMatchObject({ status: 403 });
  } finally { await db.user.update({ where: { id: cajaId }, data: { activo: true } }); }
  await expect(app.get(PaymentsService).confirmar(stale, 4400, p.id, 'Descuento no permitido')).rejects.toMatchObject({ status: 403 });
  expect(await db.auditLog.count({ where: { orderId: p.id } })).toBe(0);
});

it('B7 cancela con la misma clave real de timeout', async () => {
  const setting = await db.setting.findUnique({ where: { clave: 'pedido.timeout_minutos' } });
  try {
    await db.setting.upsert({ where: { clave: 'pedido.timeout_minutos' }, create: { clave: 'pedido.timeout_minutos', valor: 1 }, update: { valor: 1 } });
    const p = await pedido();
    await db.order.update({ where: { id: p.id }, data: { creadoEn: new Date(Date.now() - 120000) } });
    const result = await request(app.getHttpServer()).post('/admin/orders/cancelar-vencidos').auth(admin, { type: 'bearer' }).expect(200);
    expect(result.body.cancelados).toBe(1);
  } finally {
    if (setting) await db.setting.update({ where: { clave: setting.clave }, data: { valor: setting.valor! } });
    else await db.setting.delete({ where: { clave: 'pedido.timeout_minutos' } });
  }
});

it('sin sesión, COCINA y token revocado no confirman', async () => {
  const p = await pedido();
  const body = { orderId: p.id, montoRecibido: 4500 };
  await request(app.getHttpServer()).post('/admin/payments/confirmar').send(body).expect(401);
  await db.user.update({ where: { id: cajaId }, data: { rol: 'COCINA' } });
  try {
    await post('confirmar', body).expect(401);
    const cocina = app.get(JwtService).sign({ sub: cajaId, rol: 'COCINA', locationId: loc, nombre: 'Cocina' });
    await post('confirmar', body, cocina).expect(403);
  } finally { await db.user.update({ where: { id: cajaId }, data: { rol: 'CAJA' } }); }
  await db.user.update({ where: { id: cajaId }, data: { activo: false } });
  try { await post('confirmar', body).expect(401); }
  finally { await db.user.update({ where: { id: cajaId }, data: { activo: true } }); }
  expect(await db.order.findUnique({ where: { id: p.id } })).toMatchObject({ estado: 'PENDIENTE_PAGO' });
});

it('aísla búsqueda y confirmaciones por local de sesión', async () => {
  const other = loc + '-other';
  await db.location.create({ data: { id: other, nombre: 'Otro test' } });
  const p = await pedido(4500, other);
  try {
    const result = await request(app.getHttpServer()).get('/admin/payments/buscar?total=4500').auth(caja, { type: 'bearer' }).expect(200);
    expect(result.body.cantidad).toBe(0);
    await post('confirmar-por-monto', { montoRecibido: 4500 }).expect(409);
    await post('confirmar', { orderId: p.id, montoRecibido: 4500 }).expect(409);
    await post('confirmar-con-diferencia', { orderId: p.id, montoRecibido: 4400, motivo: 'No es de este local' }, admin).expect(409);
    expect(await db.auditLog.count({ where: { orderId: p.id } })).toBe(0);
  } finally { await db.order.delete({ where: { id: p.id } }); await db.location.delete({ where: { id: other } }); }
});

it('rechaza cancelados, ya pagados y cero candidatos sin duplicar auditoría', async () => {
  const p = await pedido();
  await db.order.update({ where: { id: p.id }, data: { estado: 'CANCELADO', canceladoEn: new Date() } });
  await post('confirmar', { orderId: p.id, montoRecibido: 4500 }).expect(409);
  await post('confirmar-con-diferencia', { orderId: p.id, montoRecibido: 4400, motivo: 'No revivir' }, admin).expect(409);
  await post('confirmar-por-monto', { montoRecibido: 4500 }).expect(409);
  const nuevo = await pedido();
  await post('confirmar', { orderId: nuevo.id, montoRecibido: 4500 }).expect(200);
  await post('confirmar', { orderId: nuevo.id, montoRecibido: 4500 }).expect(409);
  await post('confirmar-con-diferencia', { orderId: nuevo.id, montoRecibido: 4400, motivo: 'Pago duplicado' }, admin).expect(409);
  expect(await db.auditLog.count({ where: { orderId: nuevo.id } })).toBe(1);
});

it('una cancelación concurrente no puede convertirse en pago', async () => {
  const p = await pedido();
  const repo = app.get(PaymentsRepository);
  const real = repo.candidatos.bind(repo);
  const spy = vi.spyOn(repo, 'candidatos').mockImplementationOnce(async (...args) => {
    const candidates = await real(...args);
    await db.order.update({ where: { id: p.id }, data: { estado: 'CANCELADO', canceladoEn: new Date() } });
    return candidates;
  });
  try { await post('confirmar', { orderId: p.id, montoRecibido: 4500 }).expect(409); }
  finally { spy.mockRestore(); }
  expect(await db.order.findUnique({ where: { id: p.id } })).toMatchObject({ estado: 'CANCELADO' });
  expect(await db.auditLog.count({ where: { orderId: p.id } })).toBe(0);
});

it('si falla la escritura del log revierte el cobro completo (PostgreSQL real)', async () => {
  const p = await pedido();
  // Constraint temporal limitada a esta fila: no toca operaciones ajenas.
  const constraint = 'test_payment_audit_' + randomUUID().replaceAll('-', '');
  await db.$executeRawUnsafe(`ALTER TABLE audit_logs ADD CONSTRAINT "${constraint}" CHECK ("orderId" <> '${p.id}')`);
  app.useLogger(false);
  try {
    await post('confirmar', { orderId: p.id, montoRecibido: 4500 }).expect(500);
    expect(await db.order.findUnique({ where: { id: p.id } })).toMatchObject({ estado: 'PENDIENTE_PAGO', pagadoEn: null, confirmadoPorId: null, montoRecibido: null });
    expect(await db.auditLog.count({ where: { orderId: p.id } })).toBe(0);
  } finally { await db.$executeRawUnsafe(`ALTER TABLE audit_logs DROP CONSTRAINT "${constraint}"`); }
});

it('confirma por monto único vía HTTP y persiste autoría y auditoría', async () => {
  const p = await pedido();
  await post('confirmar-por-monto', { montoRecibido: 4500 }).expect(200);
  expect(await db.order.findUnique({ where: { id: p.id } })).toMatchObject({ estado: 'PAGADO', confirmadoPorId: cajaId, pagadoEn: expect.any(Date) });
  expect(await db.auditLog.findMany({ where: { orderId: p.id } })).toEqual([
    expect.objectContaining({ userId: cajaId, accion: 'PAGO_CONFIRMADO', montoEsperado: 4500, montoRecibido: 4500, detalle: expect.objectContaining({ candidatos: 1 }) }),
  ]);
});
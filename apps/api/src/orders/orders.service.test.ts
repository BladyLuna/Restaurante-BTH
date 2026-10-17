/**
 * Tests de B7 orders — RQ-301 a RQ-312.
 *
 * Los que más importan:
 *   - el total se recalcula en el servidor y se IGNORA el del cliente (RQ-304)
 *   - el precio se congela al pedir (RQ-305, patrón Snapshot)
 *   - un reintento no duplica el pedido (RQ-303)
 *   - la numeración no se repite ni deja huecos, ni con pedidos simultáneos
 *     (RQ-302, REPORTE SIS-02)
 *   - dos pedidos del mismo total se devuelven como ambiguos, nunca "el
 *     primero" (RQ-311, R-01)
 *   - un pedido PAGADO no se cancela: eso es una devolución (RQ-309, D-09)
 *   - un pago tardío crea un pedido NUEVO, no revive el cancelado (D-12)
 *
 * Requiere la base levantada: docker compose up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { OrdersService } from './orders.service.js';
import { OrdersRepository } from './orders.repository.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { LocationsService } from '../locations/locations.service.js';
import type { PrismaService } from '../infra/prisma.service.js';

const prisma = new PrismaClient();
const px = prisma as unknown as PrismaService;

const repo = new OrdersRepository(px);
const catalog = new CatalogService(px, {} as LocationsService);

const LOC = 'test-orders-loc';

/**
 * `porDefecto()` del servicio real devuelve el primer local activo, que sería
 * el del seed. Se fija al local de prueba para no tocar datos reales.
 */
const locations = {
  porDefecto: async () => ({ id: LOC, nombre: 'Local test orders', activo: true }),
} as unknown as LocationsService;

const orders = new OrdersService(px, repo, catalog, locations);

let idAdmin = '';
let idPique = '';
let idRefresco = '';
let idVasoVariante = '';
let idJarraVariante = '';
let idProductoAjeno = '';

async function limpiar(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE "userId" IN (SELECT id FROM users WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM orders WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM order_counters WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM payment_qrs WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM product_variants WHERE "productId" IN (SELECT p.id FROM products p JOIN categories c ON p."categoryId" = c.id WHERE c.nombre LIKE 'TEST-ORD%')`;
  await prisma.$executeRaw`DELETE FROM products WHERE "categoryId" IN (SELECT id FROM categories WHERE nombre LIKE 'TEST-ORD%')`;
  await prisma.$executeRaw`DELETE FROM categories WHERE nombre LIKE 'TEST-ORD%'`;
  await prisma.$executeRaw`DELETE FROM users WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM locations WHERE id = ${LOC}`;
}

beforeAll(async () => {
  await limpiar();

  await prisma.location.create({
    data: { id: LOC, nombre: 'Local test orders', activo: true },
  });

  const admin = await prisma.user.create({
    data: {
      locationId: LOC,
      nombre: 'Dueña test orders',
      rol: 'ADMIN',
      pinHash: 'hash-de-prueba',
      activo: true,
    },
  });
  idAdmin = admin.id;

  // Category no tiene locationId en el esquema: el menu es del negocio, no
  // de un local (ARQUITECTURA §1). Se distingue por el prefijo del nombre.
  const cat = await prisma.category.create({
    data: { nombre: 'TEST-ORD Almuerzos', orden: 1, activo: true },
  });

  const pique = await prisma.product.create({
    data: {
      categoryId: cat.id,
      nombre: 'Pique macho',
      precioBase: 4500,
      tieneVariantes: false,
      activo: true,
      orden: 1,
    },
  });
  idPique = pique.id;

  const refresco = await prisma.product.create({
    data: {
      categoryId: cat.id,
      nombre: 'Refresco',
      // El CHECK products_precio_entero exige precio > 0 incluso en los platos
      // con variantes, donde precioBase no se usa para cobrar
      // (datosParaSnapshot lee variante.precio). Se replica lo que hace el
      // seed: el precio de la variante más barata.
      precioBase: 500,
      tieneVariantes: true,
      activo: true,
      orden: 2,
    },
  });
  idRefresco = refresco.id;

  const vaso = await prisma.productVariant.create({
    data: { productId: refresco.id, nombre: 'Vaso', precio: 500, activo: true, orden: 1 },
  });
  idVasoVariante = vaso.id;

  const jarra = await prisma.productVariant.create({
    data: { productId: refresco.id, nombre: 'Jarra', precio: 1500, activo: true, orden: 2 },
  });
  idJarraVariante = jarra.id;

  // Producto con su propia variante, para el ataque CLI-02.
  const ajeno = await prisma.product.create({
    data: {
      categoryId: cat.id,
      nombre: 'Silpancho',
      precioBase: 3000,
      tieneVariantes: false,
      activo: true,
      orden: 3,
    },
  });
  idProductoAjeno = ajeno.id;
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // order_items primero: la FK apunta a orders.
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM orders WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM order_counters WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM payment_qrs WHERE "locationId" = ${LOC}`;
});

/** Pedido de un pique macho (Bs 45). */
function dtoPique(nombre = 'Juan') {
  return {
    items: [{ productId: idPique, variantId: null, cantidad: 1, notas: null }],
    nombreCliente: nombre,
    tipo: 'COMER_AQUI' as const,
    intentoUuid: randomUUID(),
  };
}

// ---------------------------------------------------------------------------
// RQ-301, RQ-304, RQ-305 — Crear
// ---------------------------------------------------------------------------

describe('crear un pedido', () => {
  it('crea el pedido y calcula el total en el servidor', async () => {
    const p = await orders.crear(dtoPique());

    expect(p.numero).toBe(1);
    expect(p.estado).toBe('PENDIENTE_PAGO');
    expect(p.total).toBe(4500);
    expect(p.nombreCliente).toBe('Juan');
    expect(p.items).toHaveLength(1);
  });

  /**
   * RQ-304 — La regla de `PLAN §6`. El cliente manda un total falso de Bs 1 y
   * el servidor cobra los Bs 45 que corresponden, sin devolver error: el dato
   * del cliente no participa de la decisión.
   */
  it('IGNORA el total que manda el cliente', async () => {
    const p = await orders.crear({ ...dtoPique(), totalCliente: 100 });
    expect(p.total).toBe(4500);
  });

  it('suma varias líneas y cantidades', async () => {
    const p = await orders.crear({
      items: [
        { productId: idPique, variantId: null, cantidad: 2, notas: null },
        { productId: idRefresco, variantId: idVasoVariante, cantidad: 3, notas: null },
      ],
      nombreCliente: 'Marta',
      tipo: 'PARA_LLEVAR',
      intentoUuid: randomUUID(),
    });

    // 2 × 4500 + 3 × 500 = 10500
    expect(p.total).toBe(10500);
    expect(p.items).toHaveLength(2);
  });

  /** RQ-305 — Patrón Snapshot. */
  it('congela el precio: subirlo después no cambia el pedido viejo', async () => {
    const p = await orders.crear(dtoPique());
    expect(p.total).toBe(4500);

    await catalog.actualizarProducto(idPique, { precioBolivianos: 60 }, idAdmin);

    const guardado = await orders.estadoPublico(p.id);
    expect(guardado.total).toBe(4500);

    const items = await prisma.orderItem.findMany({ where: { orderId: p.id } });
    expect(items[0]?.precioUnitarioSnapshot).toBe(4500);
    expect(items[0]?.nombreSnapshot).toBe('Pique macho');

    // Y el pedido siguiente sí cobra el precio nuevo.
    const nuevo = await orders.crear(dtoPique('Otro'));
    expect(nuevo.total).toBe(6000);

    await catalog.actualizarProducto(idPique, { precioBolivianos: 45 }, idAdmin);
  });

  it('guarda el nombre del plato aunque después se renombre', async () => {
    const p = await orders.crear(dtoPique());
    await prisma.product.update({
      where: { id: idPique },
      data: { nombre: 'Pique macho grande' },
    });

    const items = await prisma.orderItem.findMany({ where: { orderId: p.id } });
    expect(items[0]?.nombreSnapshot).toBe('Pique macho');

    await prisma.product.update({
      where: { id: idPique },
      data: { nombre: 'Pique macho' },
    });
  });

  it('asocia el QR activo al pedido', async () => {
    const qr = await prisma.paymentQr.create({
      data: {
        locationId: LOC,
        etiqueta: 'QR de prueba',
        imagenUrl: '/qr/prueba.png',
        activo: true,
        archivado: false,
      },
    });

    const p = await orders.crear(dtoPique());
    expect(p.qrImagenUrl).toBe('/qr/prueba.png');

    const fila = await prisma.order.findUnique({ where: { id: p.id } });
    expect(fila?.paymentQrId).toBe(qr.id);
  });

  it('crea el pedido aunque todavía no haya QR configurado', async () => {
    const p = await orders.crear(dtoPique());
    expect(p.qrImagenUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RQ-308, CLI-02 — Validación contra el catálogo
// ---------------------------------------------------------------------------

describe('validación de los ítems', () => {
  /** `REPORTE CLI-02`: pedir un plato caro con el id de una variante ajena. */
  it('rechaza una variante que no pertenece al plato', async () => {
    await expect(
      orders.crear({
        items: [
          { productId: idProductoAjeno, variantId: idVasoVariante, cantidad: 1, notas: null },
        ],
        nombreCliente: 'Atacante',
        tipo: 'COMER_AQUI',
        intentoUuid: randomUUID(),
      }),
    ).rejects.toThrow(/no corresponde/i);
  });

  it('rechaza un plato con variantes si no se elige tamaño', async () => {
    await expect(
      orders.crear({
        items: [{ productId: idRefresco, variantId: null, cantidad: 1, notas: null }],
        nombreCliente: 'Juan',
        tipo: 'COMER_AQUI',
        intentoUuid: randomUUID(),
      }),
    ).rejects.toThrow(/tamaño/i);
  });

  it('rechaza un plato desactivado', async () => {
    await catalog.cambiarActivoProducto(idPique, false, idAdmin);

    await expect(orders.crear(dtoPique())).rejects.toThrow(/no está disponible/i);

    await catalog.cambiarActivoProducto(idPique, true, idAdmin);
  });

  it('rechaza un plato que no existe', async () => {
    await expect(
      orders.crear({
        items: [{ productId: 'no-existe', variantId: null, cantidad: 1, notas: null }],
        nombreCliente: 'Juan',
        tipo: 'COMER_AQUI',
        intentoUuid: randomUUID(),
      }),
    ).rejects.toThrow(/no existe/i);
  });

  /**
   * Si un ítem falla, la transacción se revierte completa: no debe quedar un
   * pedido a medias ni un número consumido.
   */
  it('no deja pedido ni consume número si un ítem es inválido', async () => {
    await orders.crear(dtoPique());

    await expect(
      orders.crear({
        items: [
          { productId: idPique, variantId: null, cantidad: 1, notas: null },
          { productId: 'no-existe', variantId: null, cantidad: 1, notas: null },
        ],
        nombreCliente: 'Juan',
        tipo: 'COMER_AQUI',
        intentoUuid: randomUUID(),
      }),
    ).rejects.toThrow();

    const cuantos = await prisma.order.count({ where: { locationId: LOC } });
    expect(cuantos).toBe(1);

    // El número 2 sigue libre.
    const siguiente = await orders.crear(dtoPique('Tercero'));
    expect(siguiente.numero).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// RQ-302 — Numeración
// ---------------------------------------------------------------------------

describe('numeración de pedidos', () => {
  it('empieza en 1 y avanza de uno en uno', async () => {
    const a = await orders.crear(dtoPique('A'));
    const b = await orders.crear(dtoPique('B'));
    const c = await orders.crear(dtoPique('C'));

    expect([a.numero, b.numero, c.numero]).toEqual([1, 2, 3]);
  });

  /**
   * `REPORTE SIS-02` — El caso que el upsert atómico resuelve: dos pedidos
   * simultáneos al abrir la jornada, cuando la fila del contador todavía no
   * existe. Sin `ON CONFLICT`, los dos crearían la fila o los dos leerían 0.
   */
  it('no duplica números con pedidos simultáneos', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 8 }, (_, i) => orders.crear(dtoPique(`Simultaneo${i}`))),
    );

    const numeros = resultados.map((r) => r.numero).sort((x, y) => x - y);
    expect(numeros).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(numeros).size).toBe(8);
  });

  it('el UNIQUE de la base respalda la numeración', async () => {
    const p = await orders.crear(dtoPique());
    const fila = await prisma.order.findUnique({ where: { id: p.id } });

    await expect(
      prisma.order.create({
        data: {
          locationId: LOC,
          numero: fila!.numero,
          fecha: fila!.fecha,
          tipo: 'COMER_AQUI',
          nombreCliente: 'Duplicado',
          subtotal: 4500,
          total: 4500,
          intentoUuid: randomUUID(),
        },
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RQ-303 — Idempotencia
// ---------------------------------------------------------------------------

describe('idempotencia del intento', () => {
  /**
   * El motivo textual de `ARQUITECTURA §9`: "porque el WiFi se va a caer". La
   * tablet reintenta y no debe cobrarse dos veces.
   */
  it('un reintento con el mismo UUID devuelve el pedido ya creado', async () => {
    const dto = dtoPique();

    const primera = await orders.crear(dto);
    const segunda = await orders.crear(dto);

    expect(segunda.id).toBe(primera.id);
    expect(segunda.numero).toBe(primera.numero);

    const cuantos = await prisma.order.count({ where: { locationId: LOC } });
    expect(cuantos).toBe(1);
  });

  it('no consume un número en el reintento', async () => {
    const dto = dtoPique();
    await orders.crear(dto);
    await orders.crear(dto);

    const siguiente = await orders.crear(dtoPique('Otro'));
    expect(siguiente.numero).toBe(2);
  });

  it('dos reintentos simultáneos tampoco duplican', async () => {
    const dto = dtoPique();

    const [a, b, c] = await Promise.all([
      orders.crear(dto),
      orders.crear(dto),
      orders.crear(dto),
    ]);

    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);
    expect(await prisma.order.count({ where: { locationId: LOC } })).toBe(1);
  });

  it('UUID distinto sí crea un pedido nuevo', async () => {
    const a = await orders.crear(dtoPique('A'));
    const b = await orders.crear(dtoPique('B'));

    expect(b.id).not.toBe(a.id);
    expect(b.numero).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// RQ-311 / R-01 — Búsqueda por monto y ambigüedad
// ---------------------------------------------------------------------------

describe('buscar por monto', () => {
  it('encuentra un pedido por su total', async () => {
    const p = await orders.crear(dtoPique());

    const r = await orders.buscarPorMonto(LOC, 4500);
    expect(r.cantidad).toBe(1);
    expect(r.ambiguo).toBe(false);
    expect(r.pedidos[0]?.id).toBe(p.id);
  });

  /**
   * R-01 — La consecuencia de derogar el sufijo de centavos (D-04). Dos
   * pedidos de Bs 45 son indistinguibles por monto, así que el servidor
   * devuelve los dos y marca `ambiguo`. Devolver "el primero" dejaría que
   * quien confirma le acredite el pago al cliente equivocado.
   */
  it('marca ambiguo cuando dos pedidos tienen el mismo total', async () => {
    const a = await orders.crear(dtoPique('Ana'));
    const b = await orders.crear(dtoPique('Beto'));

    const r = await orders.buscarPorMonto(LOC, 4500);

    expect(r.ambiguo).toBe(true);
    expect(r.cantidad).toBe(2);

    const ids = r.pedidos.map((p) => p.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);

    // Y devuelve el nombre, que es la señal blanda para desempatar.
    const nombres = r.pedidos.map((p) => p.nombreCliente);
    expect(nombres).toContain('Ana');
    expect(nombres).toContain('Beto');
  });

  it('no devuelve nada si no hay coincidencia', async () => {
    await orders.crear(dtoPique());
    const r = await orders.buscarPorMonto(LOC, 9900);
    expect(r.cantidad).toBe(0);
  });

  it('ignora los pedidos ya cancelados', async () => {
    const p = await orders.crear(dtoPique());
    await orders.cancelar(p.id, idAdmin, 'prueba');

    const r = await orders.buscarPorMonto(LOC, 4500);
    expect(r.cantidad).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RQ-308 — Cola de pendientes
// ---------------------------------------------------------------------------

describe('cola de pendientes', () => {
  it('lista los pendientes, más viejo primero', async () => {
    const a = await orders.crear(dtoPique('Primero'));
    const b = await orders.crear(dtoPique('Segundo'));

    const cola = await orders.pendientes(LOC);
    expect(cola).toHaveLength(2);
    expect(cola[0]?.id).toBe(a.id);
    expect(cola[1]?.id).toBe(b.id);
  });

  it('no muestra los cancelados', async () => {
    const p = await orders.crear(dtoPique());
    await orders.cancelar(p.id, idAdmin, 'prueba');

    expect(await orders.pendientes(LOC)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RQ-306, RQ-309 — Cancelación
// ---------------------------------------------------------------------------

describe('cancelar', () => {
  it('cancela un pendiente y lo deja en auditoría', async () => {
    const p = await orders.crear(dtoPique());

    const r = await orders.cancelar(p.id, idAdmin, 'el cliente se fue');
    expect(r.estado).toBe('CANCELADO');

    const fila = await prisma.order.findUnique({ where: { id: p.id } });
    expect(fila?.estado).toBe('CANCELADO');
    expect(fila?.canceladoPorId).toBe(idAdmin);
    expect(fila?.canceladoMotivo).toBe('el cliente se fue');

    const log = await prisma.auditLog.findMany({
      where: { orderId: p.id, accion: 'PEDIDO_CANCELADO' },
    });
    expect(log).toHaveLength(1);
    expect(log[0]?.userId).toBe(idAdmin);
    expect(log[0]?.montoEsperado).toBe(4500);
  });

  /**
   * D-09 — Cancelar un pedido pagado no es cancelar: es devolver plata. Si esto
   * pasara acá, se cerraría un pedido cobrado sin dejar rastro de la deuda con
   * el cliente.
   */
  it('NO cancela un pedido ya pagado', async () => {
    const p = await orders.crear(dtoPique());
    await prisma.order.update({
      where: { id: p.id },
      data: { estado: 'PAGADO', pagadoEn: new Date(), confirmadoPorId: idAdmin },
    });

    await expect(orders.cancelar(p.id, idAdmin, 'intento')).rejects.toThrow(
      /devoluci/i,
    );

    const fila = await prisma.order.findUnique({ where: { id: p.id } });
    expect(fila?.estado).toBe('PAGADO');
  });

  it('no cancela dos veces el mismo pedido', async () => {
    const p = await orders.crear(dtoPique());
    await orders.cancelar(p.id, idAdmin, 'primera');

    await expect(orders.cancelar(p.id, idAdmin, 'segunda')).rejects.toThrow();

    const log = await prisma.auditLog.findMany({
      where: { orderId: p.id, accion: 'PEDIDO_CANCELADO' },
    });
    expect(log).toHaveLength(1);
  });

  it('falla si el pedido no existe', async () => {
    await expect(orders.cancelar('no-existe', idAdmin, 'x')).rejects.toThrow(
      /no existe/i,
    );
  });
});

describe('cancelar vencidos', () => {
  it('cancela los que pasaron la ventana y deja los nuevos', async () => {
    const viejo = await orders.crear(dtoPique('Viejo'));
    const nuevo = await orders.crear(dtoPique('Nuevo'));

    // 20 minutos atrás: pasó la ventana de 15.
    await prisma.order.update({
      where: { id: viejo.id },
      data: { creadoEn: new Date(Date.now() - 20 * 60_000) },
    });

    const r = await orders.cancelarVencidos(LOC);
    expect(r.cancelados).toBe(1);
    expect(r.numeros).toContain(viejo.numero);

    expect((await prisma.order.findUnique({ where: { id: viejo.id } }))?.estado).toBe(
      'CANCELADO',
    );
    expect((await prisma.order.findUnique({ where: { id: nuevo.id } }))?.estado).toBe(
      'PENDIENTE_PAGO',
    );
  });

  /** Cancelar por timeout un pedido pagado sería perder plata ya recibida. */
  it('NUNCA cancela un pedido pagado, aunque sea viejo', async () => {
    const p = await orders.crear(dtoPique());
    await prisma.order.update({
      where: { id: p.id },
      data: {
        estado: 'PAGADO',
        pagadoEn: new Date(),
        confirmadoPorId: idAdmin,
        creadoEn: new Date(Date.now() - 120 * 60_000),
      },
    });

    const r = await orders.cancelarVencidos(LOC);
    expect(r.cancelados).toBe(0);
    expect((await prisma.order.findUnique({ where: { id: p.id } }))?.estado).toBe(
      'PAGADO',
    );
  });

  it('no hace nada si no hay vencidos', async () => {
    await orders.crear(dtoPique());
    expect((await orders.cancelarVencidos(LOC)).cancelados).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RQ-310 / D-12 — Repetir cuando el pago llega tarde
// ---------------------------------------------------------------------------

describe('repetir un pedido (D-12)', () => {
  it('crea un pedido NUEVO con los mismos ítems y número nuevo', async () => {
    const original = await orders.crear({
      items: [
        { productId: idPique, variantId: null, cantidad: 2, notas: 'sin ají' },
        { productId: idRefresco, variantId: idJarraVariante, cantidad: 1, notas: null },
      ],
      nombreCliente: 'Tardón',
      tipo: 'PARA_LLEVAR',
      intentoUuid: randomUUID(),
    });
    await orders.cancelarVencidos(LOC);
    await orders.cancelar(original.id, idAdmin, 'venció');

    const copia = await orders.repetir(original.id, randomUUID());

    expect(copia.id).not.toBe(original.id);
    expect(copia.numero).toBe(original.numero + 1);
    expect(copia.estado).toBe('PENDIENTE_PAGO');
    expect(copia.total).toBe(original.total);
    expect(copia.nombreCliente).toBe('Tardón');
    expect(copia.tipo).toBe('PARA_LLEVAR');
    expect(copia.items).toHaveLength(2);
    expect(copia.items.map((i) => i.notas)).toContain('sin ají');
  });

  /**
   * El original NO se toca: queda cancelado y trazable. Revivirlo permitiría
   * atarle el pago de otro cliente a un pedido viejo.
   */
  it('deja el original cancelado, no lo revive', async () => {
    const original = await orders.crear(dtoPique());
    await orders.cancelar(original.id, idAdmin, 'venció');

    await orders.repetir(original.id, randomUUID());

    const fila = await prisma.order.findUnique({ where: { id: original.id } });
    expect(fila?.estado).toBe('CANCELADO');
  });

  /** El pedido nuevo es un pedido de hoy: si el precio cambió, cobra el nuevo. */
  it('relee los precios del catálogo', async () => {
    const original = await orders.crear(dtoPique());
    await orders.cancelar(original.id, idAdmin, 'venció');

    await catalog.actualizarProducto(idPique, { precioBolivianos: 50 }, idAdmin);
    const copia = await orders.repetir(original.id, randomUUID());

    expect(original.total).toBe(4500);
    expect(copia.total).toBe(5000);

    await catalog.actualizarProducto(idPique, { precioBolivianos: 45 }, idAdmin);
  });

  it('es idempotente: el mismo UUID no duplica la copia', async () => {
    const original = await orders.crear(dtoPique());
    await orders.cancelar(original.id, idAdmin, 'venció');

    const uuid = randomUUID();
    const a = await orders.repetir(original.id, uuid);
    const b = await orders.repetir(original.id, uuid);

    expect(b.id).toBe(a.id);
    expect(await prisma.order.count({ where: { locationId: LOC } })).toBe(2);
  });

  it('falla si el pedido original no existe', async () => {
    await expect(orders.repetir('no-existe', randomUUID())).rejects.toThrow(
      /no existe/i,
    );
  });
});

// ---------------------------------------------------------------------------
// RQ-307 — Estado público
// ---------------------------------------------------------------------------

describe('estado público', () => {
  it('devuelve el estado del pedido', async () => {
    const p = await orders.crear(dtoPique());
    const e = await orders.estadoPublico(p.id);

    expect(e.numero).toBe(p.numero);
    expect(e.estado).toBe('PENDIENTE_PAGO');
    expect(e.total).toBe(4500);
  });

  it('falla si el pedido no existe', async () => {
    await expect(orders.estadoPublico('no-existe')).rejects.toThrow(/no existe/i);
  });
});

/**
 * Tests de integración de B2 — invariantes de base de datos.
 *
 * Fuente del plan de pruebas: S1 "Integración, con DB" y ARQUITECTURA §8.
 *
 * Qué prueban: que Postgres rechace por sí mismo los datos que romperían el
 * negocio, sin ayuda de la aplicación. La validación de la app protege del
 * usuario; el CHECK protege del programador — de un seed mal escrito, de un
 * script de corrección manual, de un servicio nuevo que se olvidó la regla.
 *
 * Requiere la base levantada: docker compose up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LOC = 'test-invariantes';
const CAT = 'test-cat-invariantes';

/** Bs enteros → centavos. */
const bs = (n: number): number => n * 100;

async function limpiar(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM payment_proofs WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM refunds WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM orders WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM order_counters WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM payment_qrs WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM users WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM product_variants WHERE "productId" IN (SELECT id FROM products WHERE "categoryId" = ${CAT})`;
  await prisma.$executeRaw`DELETE FROM products WHERE "categoryId" = ${CAT}`;
  await prisma.$executeRaw`DELETE FROM categories WHERE id = ${CAT}`;
  await prisma.$executeRaw`DELETE FROM locations WHERE id = ${LOC}`;
}

beforeAll(async () => {
  await limpiar();
  await prisma.location.create({
    data: { id: LOC, nombre: 'Local de prueba', activo: true },
  });
  await prisma.category.create({
    data: { id: CAT, nombre: 'Categoría de prueba', orden: 0, activo: true },
  });
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM orders WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM payment_qrs WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM products WHERE "categoryId" = ${CAT}`;
});

describe('dinero entero — garantía de D-04 a nivel de base', () => {
  it('rechaza un precio con centavos', async () => {
    await expect(
      prisma.product.create({
        data: {
          categoryId: CAT,
          nombre: 'Con centavos',
          precioBase: 4542,
          activo: true,
          orden: 0,
          tieneVariantes: false,
        },
      }),
    ).rejects.toThrow();
  });

  it('acepta un precio entero', async () => {
    const p = await prisma.product.create({
      data: {
        categoryId: CAT,
        nombre: 'Entero',
        precioBase: bs(45),
        activo: true,
        orden: 0,
        tieneVariantes: false,
      },
    });
    expect(p.precioBase).toBe(4500);
    expect(p.precioBase % 100).toBe(0);
  });

  it('rechaza precio cero y negativo', async () => {
    await expect(
      prisma.product.create({
        data: {
          categoryId: CAT,
          nombre: 'Gratis',
          precioBase: 0,
          activo: true,
          orden: 0,
          tieneVariantes: false,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.product.create({
        data: {
          categoryId: CAT,
          nombre: 'Negativo',
          precioBase: -4500,
          activo: true,
          orden: 0,
          tieneVariantes: false,
        },
      }),
    ).rejects.toThrow();
  });

  it('rechaza un total de pedido con centavos', async () => {
    await expect(
      prisma.order.create({
        data: {
          locationId: LOC,
          numero: 1,
          fecha: new Date('2026-01-01'),
          tipo: 'COMER_AQUI',
          estado: 'PENDIENTE_PAGO',
          subtotal: 4542,
          total: 4542,
          intentoUuid: 'inv-total-centavos',
        },
      }),
    ).rejects.toThrow();
  });

  it('rechaza una variante con centavos', async () => {
    const p = await prisma.product.create({
      data: {
        categoryId: CAT,
        nombre: 'Con variantes',
        precioBase: bs(5),
        activo: true,
        orden: 0,
        tieneVariantes: true,
      },
    });

    await expect(
      prisma.productVariant.create({
        data: { productId: p.id, nombre: 'Rara', precio: 542, activo: true, orden: 0 },
      }),
    ).rejects.toThrow();
  });
});

describe('un solo QR activo por local — PLAN §5b', () => {
  it('permite el primero activo', async () => {
    const qr = await prisma.paymentQr.create({
      data: {
        locationId: LOC,
        etiqueta: 'Primero',
        imagenUrl: '/a.png',
        activo: true,
        archivado: false,
      },
    });
    expect(qr.activo).toBe(true);
  });

  it('rechaza un segundo activo en el mismo local', async () => {
    await prisma.paymentQr.create({
      data: {
        locationId: LOC,
        etiqueta: 'Primero',
        imagenUrl: '/a.png',
        activo: true,
        archivado: false,
      },
    });

    await expect(
      prisma.paymentQr.create({
        data: {
          locationId: LOC,
          etiqueta: 'Segundo',
          imagenUrl: '/b.png',
          activo: true,
          archivado: false,
        },
      }),
    ).rejects.toThrow();
  });

  it('permite varios inactivos', async () => {
    await prisma.paymentQr.create({
      data: {
        locationId: LOC,
        etiqueta: 'Inactivo 1',
        imagenUrl: '/a.png',
        activo: false,
        archivado: false,
      },
    });
    const segundo = await prisma.paymentQr.create({
      data: {
        locationId: LOC,
        etiqueta: 'Inactivo 2',
        imagenUrl: '/b.png',
        activo: false,
        archivado: false,
      },
    });
    expect(segundo.activo).toBe(false);
  });

  it('rechaza un QR archivado y activo a la vez', async () => {
    await expect(
      prisma.paymentQr.create({
        data: {
          locationId: LOC,
          etiqueta: 'Contradictorio',
          imagenUrl: '/c.png',
          activo: true,
          archivado: true,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('autoría del cobro — REPORTE C-03', () => {
  it('rechaza un pedido PAGADO sin quién lo confirmó', async () => {
    await expect(
      prisma.order.create({
        data: {
          locationId: LOC,
          numero: 10,
          fecha: new Date('2026-01-01'),
          tipo: 'COMER_AQUI',
          estado: 'PAGADO',
          subtotal: bs(45),
          total: bs(45),
          intentoUuid: 'sin-autoria',
          pagadoEn: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('rechaza un pedido PAGADO sin fecha de pago', async () => {
    const u = await prisma.user.create({
      data: {
        locationId: LOC,
        nombre: 'Cajera de prueba',
        rol: 'CAJA',
        pinHash: 'hash-falso-de-prueba',
        activo: true,
      },
    });

    await expect(
      prisma.order.create({
        data: {
          locationId: LOC,
          numero: 11,
          fecha: new Date('2026-01-01'),
          tipo: 'COMER_AQUI',
          estado: 'PAGADO',
          subtotal: bs(45),
          total: bs(45),
          intentoUuid: 'sin-fecha-pago',
          confirmadoPorId: u.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('acepta un pedido PAGADO completo', async () => {
    const u = await prisma.user.create({
      data: {
        locationId: LOC,
        nombre: 'Cajera completa',
        rol: 'CAJA',
        pinHash: 'hash-falso-de-prueba',
        activo: true,
      },
    });

    const o = await prisma.order.create({
      data: {
        locationId: LOC,
        numero: 12,
        fecha: new Date('2026-01-01'),
        tipo: 'COMER_AQUI',
        estado: 'PAGADO',
        subtotal: bs(45),
        total: bs(45),
        intentoUuid: 'pagado-completo',
        pagadoEn: new Date(),
        confirmadoPorId: u.id,
      },
    });
    expect(o.confirmadoPorId).toBe(u.id);
    expect(o.pagadoEn).not.toBeNull();
  });

  it('un pedido PENDIENTE_PAGO no necesita autoría', async () => {
    const o = await prisma.order.create({
      data: {
        locationId: LOC,
        numero: 13,
        fecha: new Date('2026-01-01'),
        tipo: 'COMER_AQUI',
        estado: 'PENDIENTE_PAGO',
        subtotal: bs(45),
        total: bs(45),
        intentoUuid: 'pendiente-sin-autoria',
      },
    });
    expect(o.confirmadoPorId).toBeNull();
  });
});

describe('idempotencia y numeración', () => {
  it('rechaza dos pedidos con el mismo intentoUuid — ARQUITECTURA §7', async () => {
    await prisma.order.create({
      data: {
        locationId: LOC,
        numero: 20,
        fecha: new Date('2026-01-02'),
        tipo: 'COMER_AQUI',
        estado: 'PENDIENTE_PAGO',
        subtotal: bs(45),
        total: bs(45),
        intentoUuid: 'uuid-repetido',
      },
    });

    await expect(
      prisma.order.create({
        data: {
          locationId: LOC,
          numero: 21,
          fecha: new Date('2026-01-02'),
          tipo: 'COMER_AQUI',
          estado: 'PENDIENTE_PAGO',
          subtotal: bs(45),
          total: bs(45),
          intentoUuid: 'uuid-repetido',
        },
      }),
    ).rejects.toThrow();
  });

  it('rechaza el mismo número en la misma fecha y local', async () => {
    await prisma.order.create({
      data: {
        locationId: LOC,
        numero: 30,
        fecha: new Date('2026-01-03'),
        tipo: 'COMER_AQUI',
        estado: 'PENDIENTE_PAGO',
        subtotal: bs(45),
        total: bs(45),
        intentoUuid: 'numero-1',
      },
    });

    await expect(
      prisma.order.create({
        data: {
          locationId: LOC,
          numero: 30,
          fecha: new Date('2026-01-03'),
          tipo: 'COMER_AQUI',
          estado: 'PENDIENTE_PAGO',
          subtotal: bs(45),
          total: bs(45),
          intentoUuid: 'numero-2',
        },
      }),
    ).rejects.toThrow();
  });

  it('permite el mismo número en fechas distintas — se reinicia cada jornada', async () => {
    await prisma.order.create({
      data: {
        locationId: LOC,
        numero: 1,
        fecha: new Date('2026-01-04'),
        tipo: 'COMER_AQUI',
        estado: 'PENDIENTE_PAGO',
        subtotal: bs(45),
        total: bs(45),
        intentoUuid: 'dia-1-numero-1',
      },
    });

    const otroDia = await prisma.order.create({
      data: {
        locationId: LOC,
        numero: 1,
        fecha: new Date('2026-01-05'),
        tipo: 'COMER_AQUI',
        estado: 'PENDIENTE_PAGO',
        subtotal: bs(45),
        total: bs(45),
        intentoUuid: 'dia-2-numero-1',
      },
    });
    expect(otroDia.numero).toBe(1);
  });

  it('rechaza número cero o negativo', async () => {
    await expect(
      prisma.order.create({
        data: {
          locationId: LOC,
          numero: 0,
          fecha: new Date('2026-01-06'),
          tipo: 'COMER_AQUI',
          estado: 'PENDIENTE_PAGO',
          subtotal: bs(45),
          total: bs(45),
          intentoUuid: 'numero-cero',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('cantidades de ítems', () => {
  it('rechaza cantidad cero', async () => {
    const p = await prisma.product.create({
      data: {
        categoryId: CAT,
        nombre: 'Para items',
        precioBase: bs(45),
        activo: true,
        orden: 0,
        tieneVariantes: false,
      },
    });
    const o = await prisma.order.create({
      data: {
        locationId: LOC,
        numero: 40,
        fecha: new Date('2026-01-07'),
        tipo: 'COMER_AQUI',
        estado: 'PENDIENTE_PAGO',
        subtotal: bs(45),
        total: bs(45),
        intentoUuid: 'con-items',
      },
    });

    await expect(
      prisma.orderItem.create({
        data: {
          orderId: o.id,
          productId: p.id,
          cantidad: 0,
          nombreSnapshot: 'Para items',
          precioUnitarioSnapshot: bs(45),
        },
      }),
    ).rejects.toThrow();
  });
});

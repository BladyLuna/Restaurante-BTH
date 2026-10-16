/**
 * Tests de B6 catalog — RQ-201 a RQ-211.
 *
 * Los que más importan:
 *   - desactivar no borra y no rompe pedidos históricos (RQ-204)
 *   - un cambio de precio deja auditoría en la misma transacción (RQ-209, D-07)
 *   - la variante ajena se rechaza en el servidor (RQ-208, REPORTE CLI-02)
 *
 * Requiere la base levantada: docker compose up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CatalogService } from './catalog.service.js';
import type { PrismaService } from '../infra/prisma.service.js';
import type { LocationsService } from '../locations/locations.service.js';

const prisma = new PrismaClient();
const catalog = new CatalogService(
  prisma as unknown as PrismaService,
  {} as LocationsService,
);

const LOC = 'test-catalog-loc';
let idUsuario = '';
let idCategoria = '';

async function limpiar(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE "userId" IN (SELECT id FROM users WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM orders WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM product_variants WHERE "productId" IN (SELECT p.id FROM products p JOIN categories c ON p."categoryId" = c.id WHERE c.nombre LIKE 'TEST-CAT%')`;
  await prisma.$executeRaw`DELETE FROM products WHERE "categoryId" IN (SELECT id FROM categories WHERE nombre LIKE 'TEST-CAT%')`;
  await prisma.$executeRaw`DELETE FROM categories WHERE nombre LIKE 'TEST-CAT%'`;
  await prisma.$executeRaw`DELETE FROM users WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM locations WHERE id = ${LOC}`;
}

beforeAll(async () => {
  await limpiar();
  await prisma.location.create({
    data: { id: LOC, nombre: 'Local test catalog', activo: true },
  });
  const u = await prisma.user.create({
    data: {
      locationId: LOC,
      nombre: 'Dueña test catalog',
      rol: 'ADMIN',
      pinHash: 'hash-de-prueba',
      activo: true,
    },
  });
  idUsuario = u.id;
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Orden importante: los OrderItem referencian productos, así que se borran
  // primero. El test del pedido histórico deja uno.
  await prisma.$executeRaw`DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "locationId" = ${LOC})`;
  await prisma.$executeRaw`DELETE FROM orders WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM product_variants WHERE "productId" IN (SELECT p.id FROM products p JOIN categories c ON p."categoryId" = c.id WHERE c.nombre LIKE 'TEST-CAT%')`;
  await prisma.$executeRaw`DELETE FROM products WHERE "categoryId" IN (SELECT id FROM categories WHERE nombre LIKE 'TEST-CAT%')`;
  await prisma.$executeRaw`DELETE FROM categories WHERE nombre LIKE 'TEST-CAT%'`;
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE "userId" = ${idUsuario}`;

  const c = await catalog.crearCategoria({ nombre: 'TEST-CAT Almuerzos' });
  idCategoria = c.id;
});

describe('RQ-201 — categorías', () => {
  it('crea una categoría', async () => {
    const c = await catalog.crearCategoria({ nombre: 'TEST-CAT Bebidas' });
    expect(c.nombre).toBe('TEST-CAT Bebidas');
    expect(c.activo).toBe(true);
  });

  it('rechaza nombre duplicado', async () => {
    await expect(
      catalog.crearCategoria({ nombre: 'TEST-CAT Almuerzos' }),
    ).rejects.toThrow();
  });

  it('asigna orden incremental', async () => {
    const b = await catalog.crearCategoria({ nombre: 'TEST-CAT Sopas' });
    const c = await catalog.crearCategoria({ nombre: 'TEST-CAT Postres' });
    expect(c.orden).toBeGreaterThan(b.orden);
  });

  it('renombra', async () => {
    const c = await catalog.actualizarCategoria(idCategoria, {
      nombre: 'TEST-CAT Platos del día',
    });
    expect(c.nombre).toBe('TEST-CAT Platos del día');
  });
});

describe('RQ-202 — platos', () => {
  it('crea un plato con precio en bolivianos enteros', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Pique macho',
      descripcion: 'Para compartir',
      precioBolivianos: 45,
    });
    expect(p.precioCentavos).toBe(4500);
    expect(p.activo).toBe(true);
    expect(p.tieneVariantes).toBe(false);
  });

  it('rechaza una categoría que no existe', async () => {
    await expect(
      catalog.crearProducto({
        categoryId: 'no-existe',
        nombre: 'Fantasma',
        precioBolivianos: 10,
      }),
    ).rejects.toThrow();
  });

  it('cambia el nombre sin tocar el precio', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Silpancho',
      precioBolivianos: 30,
    });
    const actualizado = await catalog.actualizarProducto(
      p.id,
      { nombre: 'Silpancho especial' },
      idUsuario,
    );
    expect(actualizado.nombre).toBe('Silpancho especial');
    expect(actualizado.precioCentavos).toBe(3000);
  });
});

describe('RQ-204 — desactivar, nunca borrar', () => {
  it('un plato desactivado desaparece del catálogo público pero sigue en la base', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Pollo al horno',
      precioBolivianos: 28,
    });

    await catalog.cambiarActivoProducto(p.id, false, idUsuario);

    const publico = await catalog.catalogoPublico();
    const cat = publico.find((c) => c.id === idCategoria);
    expect(cat?.productos.find((x) => x.id === p.id)).toBeUndefined();

    // Sigue existiendo: es lo que protege los pedidos históricos.
    const enBase = await prisma.product.findUnique({ where: { id: p.id } });
    expect(enBase).not.toBeNull();
    expect(enBase?.activo).toBe(false);
  });

  it('el panel sí muestra los inactivos: la dueña debe poder reactivar', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Trucha',
      precioBolivianos: 40,
    });
    await catalog.cambiarActivoProducto(p.id, false, idUsuario);

    const admin = await catalog.catalogoAdmin();
    const cat = admin.find((c) => c.id === idCategoria);
    const encontrado = cat?.productos.find((x) => x.id === p.id);
    expect(encontrado).toBeDefined();
    expect(encontrado?.activo).toBe(false);
  });

  it('se puede reactivar', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Chicharrón',
      precioBolivianos: 35,
    });
    await catalog.cambiarActivoProducto(p.id, false, idUsuario);
    await catalog.cambiarActivoProducto(p.id, true, idUsuario);

    const publico = await catalog.catalogoPublico();
    const cat = publico.find((c) => c.id === idCategoria);
    expect(cat?.productos.find((x) => x.id === p.id)).toBeDefined();
  });

  it('desactivar un plato que está en un pedido histórico no rompe el pedido', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Lomo montado',
      precioBolivianos: 32,
    });

    const pedido = await prisma.order.create({
      data: {
        locationId: LOC,
        numero: 1,
        fecha: new Date('2026-02-01'),
        tipo: 'COMER_AQUI',
        estado: 'PENDIENTE_PAGO',
        subtotal: 3200,
        total: 3200,
        intentoUuid: 'test-catalog-historico',
        items: {
          create: {
            productId: p.id,
            cantidad: 1,
            nombreSnapshot: 'Lomo montado',
            precioUnitarioSnapshot: 3200,
          },
        },
      },
      include: { items: true },
    });

    await catalog.cambiarActivoProducto(p.id, false, idUsuario);

    const despues = await prisma.order.findUnique({
      where: { id: pedido.id },
      include: { items: true },
    });
    expect(despues?.items).toHaveLength(1);
    expect(despues?.items[0]?.nombreSnapshot).toBe('Lomo montado');
    expect(despues?.items[0]?.precioUnitarioSnapshot).toBe(3200);
  });

  it('desactivar una categoría desactiva sus platos en cascada', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Sopa de maní',
      precioBolivianos: 18,
    });

    await catalog.cambiarActivoCategoria(idCategoria, false, idUsuario);

    const enBase = await prisma.product.findUnique({ where: { id: p.id } });
    expect(enBase?.activo).toBe(false);
  });
});

describe('RQ-209 — auditoría de cambios de precio, dentro de la transacción', () => {
  it('cambiar el precio deja fila de auditoría', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Milanesa',
      precioBolivianos: 28,
    });

    await catalog.actualizarProducto(
      p.id,
      { precioBolivianos: 32 },
      idUsuario,
    );

    const filas = await prisma.auditLog.findMany({
      where: { accion: 'PRECIO_CAMBIADO', productId: p.id },
    });
    expect(filas).toHaveLength(1);

    const detalle = filas[0]?.detalle as {
      precioAnteriorCentavos?: number;
      precioNuevoCentavos?: number;
    } | null;
    expect(detalle?.precioAnteriorCentavos).toBe(2800);
    expect(detalle?.precioNuevoCentavos).toBe(3200);
  });

  it('registra quién cambió el precio', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Fricasé',
      precioBolivianos: 25,
    });
    await catalog.actualizarProducto(p.id, { precioBolivianos: 30 }, idUsuario);

    const fila = await prisma.auditLog.findFirst({
      where: { accion: 'PRECIO_CAMBIADO', productId: p.id },
    });
    expect(fila?.userId).toBe(idUsuario);
  });

  it('un cambio que no toca el precio no genera auditoría de precio', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Majadito',
      precioBolivianos: 26,
    });
    await catalog.actualizarProducto(
      p.id,
      { nombre: 'Majadito batido' },
      idUsuario,
    );

    const filas = await prisma.auditLog.findMany({
      where: { accion: 'PRECIO_CAMBIADO', productId: p.id },
    });
    expect(filas).toHaveLength(0);
  });

  it('poner el mismo precio no genera auditoría', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Charque',
      precioBolivianos: 30,
    });
    await catalog.actualizarProducto(p.id, { precioBolivianos: 30 }, idUsuario);

    const filas = await prisma.auditLog.findMany({
      where: { accion: 'PRECIO_CAMBIADO', productId: p.id },
    });
    expect(filas).toHaveLength(0);
  });

  it('activar y desactivar también se audita', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Ranga',
      precioBolivianos: 22,
    });
    await catalog.cambiarActivoProducto(p.id, false, idUsuario);

    const filas = await prisma.auditLog.findMany({
      where: { accion: 'PRODUCTO_DESACTIVADO', productId: p.id },
    });
    expect(filas.length).toBeGreaterThan(0);
  });
});

describe('RQ-203 — variantes', () => {
  it('la primera variante pone tieneVariantes en true', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Refresco',
      precioBolivianos: 5,
    });
    expect(p.tieneVariantes).toBe(false);

    await catalog.crearVariante(p.id, { nombre: 'Vaso', precioBolivianos: 5 });

    const enBase = await prisma.product.findUnique({ where: { id: p.id } });
    expect(enBase?.tieneVariantes).toBe(true);
  });

  it('desactivar la última variante activa vuelve el plato a precio simple', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Agua',
      precioBolivianos: 5,
    });
    const v = await catalog.crearVariante(p.id, {
      nombre: '500 ml',
      precioBolivianos: 5,
    });

    await catalog.cambiarActivoVariante(v.id, false, idUsuario);

    const enBase = await prisma.product.findUnique({ where: { id: p.id } });
    expect(enBase?.tieneVariantes).toBe(false);
  });

  it('con dos variantes, desactivar una deja tieneVariantes en true', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Jugo',
      precioBolivianos: 8,
    });
    const v1 = await catalog.crearVariante(p.id, {
      nombre: 'Vaso',
      precioBolivianos: 8,
    });
    await catalog.crearVariante(p.id, {
      nombre: 'Jarra',
      precioBolivianos: 20,
    });

    await catalog.cambiarActivoVariante(v1.id, false, idUsuario);

    const enBase = await prisma.product.findUnique({ where: { id: p.id } });
    expect(enBase?.tieneVariantes).toBe(true);
  });

  it('cambiar el precio de una variante se audita', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Café',
      precioBolivianos: 8,
    });
    const v = await catalog.crearVariante(p.id, {
      nombre: 'Grande',
      precioBolivianos: 12,
    });

    await catalog.actualizarVariante(v.id, { precioBolivianos: 15 }, idUsuario);

    const fila = await prisma.auditLog.findFirst({
      where: { accion: 'PRECIO_CAMBIADO', productId: p.id },
    });
    const detalle = fila?.detalle as { entidad?: string } | null;
    expect(detalle?.entidad).toBe('variante');
  });
});

describe('RQ-205 — reordenar', () => {
  it('el catálogo sale ordenado', async () => {
    const a = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Primero',
      precioBolivianos: 10,
    });
    const b = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Segundo',
      precioBolivianos: 10,
    });

    // Invertir: lo que la dueña quiere vender va primero.
    await catalog.reordenarProductos([b.id, a.id]);

    const publico = await catalog.catalogoPublico();
    const cat = publico.find((c) => c.id === idCategoria);
    expect(cat?.productos[0]?.id).toBe(b.id);
    expect(cat?.productos[1]?.id).toBe(a.id);
  });

  it('rechaza ids repetidos', async () => {
    const a = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Uno',
      precioBolivianos: 10,
    });
    await expect(catalog.reordenarProductos([a.id, a.id])).rejects.toThrow();
  });

  it('rechaza un id que no existe', async () => {
    await expect(catalog.reordenarProductos(['no-existe'])).rejects.toThrow();
  });
});

describe('RQ-208 — datos para el snapshot que usará B7', () => {
  it('devuelve nombre y precio de un plato simple', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Pique macho',
      precioBolivianos: 45,
    });

    const snap = await catalog.datosParaSnapshot(p.id, null);
    expect(snap.nombre).toBe('Pique macho');
    expect(snap.precioCentavos).toBe(4500);
  });

  it('con variante, devuelve el precio de la variante', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Refresco',
      precioBolivianos: 5,
    });
    const v = await catalog.crearVariante(p.id, {
      nombre: 'Jarra',
      precioBolivianos: 15,
    });

    const snap = await catalog.datosParaSnapshot(p.id, v.id);
    expect(snap.nombre).toBe('Refresco Jarra');
    expect(snap.precioCentavos).toBe(1500);
  });

  it('rechaza un plato desactivado: no se puede pedir algo agotado', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Agotado',
      precioBolivianos: 20,
    });
    await catalog.cambiarActivoProducto(p.id, false, idUsuario);

    await expect(catalog.datosParaSnapshot(p.id, null)).rejects.toThrow(
      /no está disponible/,
    );
  });

  it('rechaza una variante que no pertenece al plato — REPORTE CLI-02', async () => {
    const caro = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Plato caro',
      precioBolivianos: 60,
    });
    const barato = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Plato barato',
      precioBolivianos: 10,
    });
    const varianteBarata = await catalog.crearVariante(barato.id, {
      nombre: 'Chico',
      precioBolivianos: 5,
    });

    // Intento de pedir el plato caro con el precio de la variante del barato.
    await expect(
      catalog.datosParaSnapshot(caro.id, varianteBarata.id),
    ).rejects.toThrow(/no corresponde/);
  });

  it('exige elegir tamaño si el plato tiene variantes', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Con tamaños',
      precioBolivianos: 10,
    });
    await catalog.crearVariante(p.id, {
      nombre: 'Grande',
      precioBolivianos: 15,
    });

    await expect(catalog.datosParaSnapshot(p.id, null)).rejects.toThrow(
      /elegir un tamaño/,
    );
  });

  it('rechaza una variante desactivada', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Con variante inactiva',
      precioBolivianos: 10,
    });
    const v1 = await catalog.crearVariante(p.id, {
      nombre: 'Agotada',
      precioBolivianos: 12,
    });
    await catalog.crearVariante(p.id, {
      nombre: 'Disponible',
      precioBolivianos: 15,
    });
    await catalog.cambiarActivoVariante(v1.id, false, idUsuario);

    await expect(catalog.datosParaSnapshot(p.id, v1.id)).rejects.toThrow(
      /no está disponible/,
    );
  });

  it('rechaza un plato que no existe', async () => {
    await expect(
      catalog.datosParaSnapshot('no-existe', null),
    ).rejects.toThrow();
  });
});

describe('RQ-210 — catálogo público', () => {
  it('no incluye categorías inactivas', async () => {
    await catalog.cambiarActivoCategoria(idCategoria, false, idUsuario);
    const publico = await catalog.catalogoPublico();
    expect(publico.find((c) => c.id === idCategoria)).toBeUndefined();
  });

  it('incluye variantes activas de cada plato', async () => {
    const p = await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Con opciones',
      precioBolivianos: 10,
    });
    await catalog.crearVariante(p.id, {
      nombre: 'Chico',
      precioBolivianos: 10,
    });
    await catalog.crearVariante(p.id, {
      nombre: 'Grande',
      precioBolivianos: 18,
    });

    const publico = await catalog.catalogoPublico();
    const encontrado = publico
      .find((c) => c.id === idCategoria)
      ?.productos.find((x) => x.id === p.id);
    expect(encontrado?.variantes).toHaveLength(2);
  });

  it('todos los precios que devuelve son múltiplos de 100 — D-04', async () => {
    await catalog.crearProducto({
      categoryId: idCategoria,
      nombre: 'Verificación',
      precioBolivianos: 37,
    });

    const publico = await catalog.catalogoPublico();
    for (const cat of publico) {
      for (const prod of cat.productos) {
        expect(prod.precioCentavos % 100).toBe(0);
        for (const v of prod.variantes) {
          expect(v.precioCentavos % 100).toBe(0);
        }
      }
    }
  });
});

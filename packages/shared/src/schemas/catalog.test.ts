/**
 * Tests de los schemas de catálogo — RQ-104 / RQ-207.
 * Unitarios, sin base de datos.
 *
 * El que importa: que un precio con centavos sea rechazado por el mismo schema
 * que usa el cliente. Si cliente y servidor validaran distinto, el panel
 * dejaría pasar algo que la API rechaza con un error que la UI no sabe mostrar.
 */

import { describe, it, expect } from 'vitest';
import {
  PrecioCentavos,
  PrecioBolivianos,
  CrearProducto,
  ActualizarProducto,
  CrearCategoria,
  CrearVariante,
  CambiarActivo,
  Reordenar,
} from './catalog.js';

describe('PrecioCentavos — D-04', () => {
  it('acepta múltiplos de 100', () => {
    expect(PrecioCentavos.safeParse(4500).success).toBe(true);
    expect(PrecioCentavos.safeParse(100).success).toBe(true);
  });

  it('rechaza montos con centavos', () => {
    expect(PrecioCentavos.safeParse(4542).success).toBe(false);
    expect(PrecioCentavos.safeParse(4501).success).toBe(false);
  });

  it('el mensaje explica la regla', () => {
    const r = PrecioCentavos.safeParse(4542);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors[0]?.message).toContain('bolivianos enteros');
    }
  });

  it('rechaza cero, negativos y decimales', () => {
    expect(PrecioCentavos.safeParse(0).success).toBe(false);
    expect(PrecioCentavos.safeParse(-4500).success).toBe(false);
    expect(PrecioCentavos.safeParse(4500.5).success).toBe(false);
  });
});

describe('PrecioBolivianos — lo que tipea la dueña', () => {
  it('acepta enteros positivos', () => {
    expect(PrecioBolivianos.safeParse(45).success).toBe(true);
  });

  it('rechaza decimales: el panel no pide centavos', () => {
    expect(PrecioBolivianos.safeParse(45.42).success).toBe(false);
    expect(PrecioBolivianos.safeParse(45.5).success).toBe(false);
  });

  it('rechaza cero y negativos', () => {
    expect(PrecioBolivianos.safeParse(0).success).toBe(false);
    expect(PrecioBolivianos.safeParse(-10).success).toBe(false);
  });

  it('rechaza un precio absurdo: probablemente un dedo de más', () => {
    expect(PrecioBolivianos.safeParse(999_999).success).toBe(false);
  });
});

describe('CrearProducto', () => {
  it('acepta lo mínimo necesario', () => {
    const r = CrearProducto.safeParse({
      categoryId: 'cat1',
      nombre: 'Pique macho',
      precioBolivianos: 45,
    });
    expect(r.success).toBe(true);
  });

  it('rechaza precio con centavos', () => {
    const r = CrearProducto.safeParse({
      categoryId: 'cat1',
      nombre: 'Pique macho',
      precioBolivianos: 45.42,
    });
    expect(r.success).toBe(false);
  });

  it('rechaza nombre vacío o solo espacios', () => {
    expect(
      CrearProducto.safeParse({
        categoryId: 'cat1',
        nombre: '',
        precioBolivianos: 45,
      }).success,
    ).toBe(false);
    expect(
      CrearProducto.safeParse({
        categoryId: 'cat1',
        nombre: '   ',
        precioBolivianos: 45,
      }).success,
    ).toBe(false);
  });

  it('recorta espacios del nombre', () => {
    const r = CrearProducto.safeParse({
      categoryId: 'cat1',
      nombre: '  Silpancho  ',
      precioBolivianos: 30,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nombre).toBe('Silpancho');
  });

  it('rechaza si falta la categoría', () => {
    expect(
      CrearProducto.safeParse({ nombre: 'Huérfano', precioBolivianos: 10 })
        .success,
    ).toBe(false);
  });
});

describe('ActualizarProducto — todo opcional', () => {
  it('acepta un objeto vacío', () => {
    expect(ActualizarProducto.safeParse({}).success).toBe(true);
  });

  it('acepta solo el precio', () => {
    expect(ActualizarProducto.safeParse({ precioBolivianos: 32 }).success).toBe(
      true,
    );
  });

  it('sigue rechazando un precio inválido', () => {
    expect(
      ActualizarProducto.safeParse({ precioBolivianos: 32.5 }).success,
    ).toBe(false);
  });
});

describe('CrearCategoria y CrearVariante', () => {
  it('categoría con nombre basta', () => {
    expect(CrearCategoria.safeParse({ nombre: 'Bebidas' }).success).toBe(true);
  });

  it('variante exige nombre y precio', () => {
    expect(
      CrearVariante.safeParse({ nombre: 'Jarra', precioBolivianos: 15 })
        .success,
    ).toBe(true);
    expect(CrearVariante.safeParse({ nombre: 'Jarra' }).success).toBe(false);
  });
});

describe('CambiarActivo', () => {
  it('exige un booleano', () => {
    expect(CambiarActivo.safeParse({ activo: false }).success).toBe(true);
    expect(CambiarActivo.safeParse({ activo: 'no' }).success).toBe(false);
    expect(CambiarActivo.safeParse({}).success).toBe(false);
  });
});

describe('Reordenar', () => {
  it('acepta una lista de ids', () => {
    expect(Reordenar.safeParse({ ids: ['a', 'b', 'c'] }).success).toBe(true);
  });

  it('rechaza lista vacía', () => {
    expect(Reordenar.safeParse({ ids: [] }).success).toBe(false);
  });
});

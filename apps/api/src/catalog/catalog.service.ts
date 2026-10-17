/**
 * B6 — catalog
 *
 * Fuente: PLAN §4, §6, §7; ARQUITECTURA §2; D-04, D-07.
 *
 * Profundidad de slice: controller → service → Prisma directo, SIN repositorio.
 * Fuente: ARQUITECTURA §2, tabla de profundidad variable. Un repositorio acá
 * sería "una capa que solo reenvía llamadas": la capa se agrega cuando hay
 * lógica que proteger, no por simetría.
 *
 * Dos reglas que gobiernan este archivo:
 *
 *   1. NUNCA SE BORRA (RQ-204). Un plato borrado dejaría OrderItem huérfanos y
 *      corrompería los reportes históricos (PLAN §4). Se desactiva.
 *
 *   2. UN CAMBIO DE PRECIO ES UN EVENTO FINANCIERO (RQ-209, D-07). Se audita
 *      DENTRO de la misma transacción, no por listener. Si el log se escribiera
 *      después del commit y el servidor se reiniciara en esa ventana, quedaría
 *      un precio cambiado sin autor — y el log existe precisamente "para poder
 *      explicar un cierre que no cuadra" (PLAN §7).
 */

import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service.js';
import { LocationsService } from '../locations/locations.service.js';
import type {
  CrearCategoriaDto,
  ActualizarCategoriaDto,
  CrearProductoDto,
  ActualizarProductoDto,
  CrearVarianteDto,
  ActualizarVarianteDto,
} from '@restaurante/shared';

/** Bs enteros → centavos. La conversión vive en un solo lugar. */
function aCentavos(bolivianos: number): number {
  return bolivianos * 100;
}

export type VarianteDto = {
  id: string;
  nombre: string;
  precioCentavos: number;
  activo: boolean;
  orden: number;
};

export type ProductoDto = {
  id: string;
  categoryId: string;
  nombre: string;
  descripcion: string | null;
  precioCentavos: number;
  imagenUrl: string | null;
  activo: boolean;
  orden: number;
  tieneVariantes: boolean;
  variantes: VarianteDto[];
};

export type CategoriaDto = {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
  productos: ProductoDto[];
};

@Injectable()
export class CatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LocationsService) private readonly locations: LocationsService,
  ) {}

  // -------------------------------------------------------------------------
  // RQ-210 — Catálogo público
  // -------------------------------------------------------------------------

  /**
   * Lo que ve el kiosco. Solo activo, ya ordenado.
   *
   * Un plato desactivado desaparece de acá pero sigue existiendo en la base, y
   * los pedidos históricos que lo referencian siguen íntegros (RQ-204).
   */
  async catalogoPublico(): Promise<CategoriaDto[]> {
    const categorias = await this.prisma.category.findMany({
      where: { activo: true },
      orderBy: { orden: 'asc' },
      include: {
        products: {
          where: { activo: true },
          orderBy: { orden: 'asc' },
          include: {
            variants: {
              where: { activo: true },
              orderBy: { orden: 'asc' },
            },
          },
        },
      },
    });

    return categorias.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      orden: c.orden,
      activo: c.activo,
      productos: c.products.map((p) => ({
        id: p.id,
        categoryId: p.categoryId,
        nombre: p.nombre,
        descripcion: p.descripcion,
        precioCentavos: p.precioBase,
        imagenUrl: p.imagenUrl,
        activo: p.activo,
        orden: p.orden,
        tieneVariantes: p.tieneVariantes,
        variantes: p.variants.map((v) => ({
          id: v.id,
          nombre: v.nombre,
          precioCentavos: v.precio,
          activo: v.activo,
          orden: v.orden,
        })),
      })),
    }));
  }

  /**
   * Lo que ve el panel: incluye inactivos, porque la dueña necesita poder
   * reactivar el pollo mañana.
   */
  async catalogoAdmin(): Promise<CategoriaDto[]> {
    const categorias = await this.prisma.category.findMany({
      orderBy: { orden: 'asc' },
      include: {
        products: {
          orderBy: { orden: 'asc' },
          include: { variants: { orderBy: { orden: 'asc' } } },
        },
      },
    });

    return categorias.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      orden: c.orden,
      activo: c.activo,
      productos: c.products.map((p) => ({
        id: p.id,
        categoryId: p.categoryId,
        nombre: p.nombre,
        descripcion: p.descripcion,
        precioCentavos: p.precioBase,
        imagenUrl: p.imagenUrl,
        activo: p.activo,
        orden: p.orden,
        tieneVariantes: p.tieneVariantes,
        variantes: p.variants.map((v) => ({
          id: v.id,
          nombre: v.nombre,
          precioCentavos: v.precio,
          activo: v.activo,
          orden: v.orden,
        })),
      })),
    }));
  }

  // -------------------------------------------------------------------------
  // RQ-201 — Categorías
  // -------------------------------------------------------------------------

  async crearCategoria(dto: CrearCategoriaDto): Promise<CategoriaDto> {
    const existente = await this.prisma.category.findFirst({
      where: { nombre: dto.nombre },
    });
    if (existente !== null) {
      throw new ConflictException(`Ya existe una categoría "${dto.nombre}"`);
    }

    const orden = dto.orden ?? (await this.siguienteOrdenCategoria());
    const c = await this.prisma.category.create({
      data: { nombre: dto.nombre, orden, activo: true },
    });

    return { id: c.id, nombre: c.nombre, orden: c.orden, activo: c.activo, productos: [] };
  }

  async actualizarCategoria(
    id: string,
    dto: ActualizarCategoriaDto,
  ): Promise<CategoriaDto> {
    await this.categoriaOFalla(id);

    if (dto.nombre !== undefined) {
      const choque = await this.prisma.category.findFirst({
        where: { nombre: dto.nombre, id: { not: id } },
      });
      if (choque !== null) {
        throw new ConflictException(`Ya existe una categoría "${dto.nombre}"`);
      }
    }

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.orden !== undefined) data.orden = dto.orden;

    const c = await this.prisma.category.update({ where: { id }, data });
    return { id: c.id, nombre: c.nombre, orden: c.orden, activo: c.activo, productos: [] };
  }

  /**
   * Desactivar una categoría desactiva sus platos en cascada.
   *
   * Razón: si la categoría desaparece del kiosco pero sus platos siguen
   * "activos" en la base, el panel muestra platos activos que ningún cliente
   * puede pedir. Es una incoherencia que confunde al mirar la lista.
   */
  async cambiarActivoCategoria(
    id: string,
    activo: boolean,
    userId: string,
  ): Promise<void> {
    await this.categoriaOFalla(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { activo } });

      if (!activo) {
        await tx.product.updateMany({
          where: { categoryId: id },
          data: { activo: false },
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          accion: activo ? 'PRODUCTO_ACTIVADO' : 'PRODUCTO_DESACTIVADO',
          detalle: {
            entidad: 'categoria',
            categoryId: id,
            cascada: !activo,
          },
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // RQ-202 — Platos
  // -------------------------------------------------------------------------

  async crearProducto(dto: CrearProductoDto): Promise<ProductoDto> {
    await this.categoriaOFalla(dto.categoryId);

    const orden = dto.orden ?? (await this.siguienteOrdenProducto(dto.categoryId));

    const p = await this.prisma.product.create({
      data: {
        categoryId: dto.categoryId,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        precioBase: aCentavos(dto.precioBolivianos),
        activo: true,
        orden,
        tieneVariantes: false,
      },
      include: { variants: true },
    });

    return this.aProductoDto(p);
  }

  /**
   * RQ-209 — Un cambio de precio se audita dentro de la transacción.
   *
   * El resto de los campos (nombre, descripción, orden) no son financieros y no
   * exigen auditoría. El precio sí: es lo que la dueña va a querer explicar
   * cuando un cierre no cuadre.
   */
  async actualizarProducto(
    id: string,
    dto: ActualizarProductoDto,
    userId: string,
  ): Promise<ProductoDto> {
    const anterior = await this.productoOFalla(id);

    if (dto.categoryId !== undefined) {
      await this.categoriaOFalla(dto.categoryId);
    }

    const data: Prisma.ProductUpdateInput = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.descripcion !== undefined) data.descripcion = dto.descripcion;
    if (dto.orden !== undefined) data.orden = dto.orden;
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }

    const cambiaPrecio = dto.precioBolivianos !== undefined;
    const precioNuevo =
      dto.precioBolivianos !== undefined
        ? aCentavos(dto.precioBolivianos)
        : anterior.precioBase;

    if (cambiaPrecio) data.precioBase = precioNuevo;

    // Sin cambio de precio: update simple, no hace falta transacción.
    if (!cambiaPrecio || precioNuevo === anterior.precioBase) {
      const p = await this.prisma.product.update({
        where: { id },
        data,
        include: { variants: { orderBy: { orden: 'asc' } } },
      });
      return this.aProductoDto(p);
    }

    // Con cambio de precio: el update y la fila de auditoría viven o mueren
    // juntos (D-07). Nunca uno sin el otro.
    const p = await this.prisma.$transaction(async (tx) => {
      const actualizado = await tx.product.update({
        where: { id },
        data,
        include: { variants: { orderBy: { orden: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          userId,
          productId: id,
          accion: 'PRECIO_CAMBIADO',
          detalle: {
            entidad: 'producto',
            nombre: actualizado.nombre,
            precioAnteriorCentavos: anterior.precioBase,
            precioNuevoCentavos: precioNuevo,
          },
        },
      });

      return actualizado;
    });

    return this.aProductoDto(p);
  }

  /**
   * RQ-204 — Activar y desactivar. Nunca eliminar.
   *
   * Es la acción más frecuente del día (se acabó el pollo) y debe resolverse en
   * un solo toque, sin confirmación (PLAN §7). Es reversible: por eso no pide
   * confirmar.
   */
  async cambiarActivoProducto(
    id: string,
    activo: boolean,
    userId: string,
  ): Promise<void> {
    const producto = await this.productoOFalla(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: { activo } });
      await tx.auditLog.create({
        data: {
          userId,
          productId: id,
          accion: activo ? 'PRODUCTO_ACTIVADO' : 'PRODUCTO_DESACTIVADO',
          detalle: { entidad: 'producto', nombre: producto.nombre },
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // RQ-203 — Variantes
  // -------------------------------------------------------------------------

  /**
   * Agregar la primera variante pone tieneVariantes = true, y el kiosco pasa a
   * mostrar los tamaños en vez de agregar con un toque (PLAN §4).
   */
  async crearVariante(
    productId: string,
    dto: CrearVarianteDto,
  ): Promise<VarianteDto> {
    await this.productoOFalla(productId);

    const orden = dto.orden ?? (await this.siguienteOrdenVariante(productId));

    const v = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.productVariant.create({
        data: {
          productId,
          nombre: dto.nombre,
          precio: aCentavos(dto.precioBolivianos),
          activo: true,
          orden,
        },
      });

      await tx.product.update({
        where: { id: productId },
        data: { tieneVariantes: true },
      });

      return creada;
    });

    return {
      id: v.id,
      nombre: v.nombre,
      precioCentavos: v.precio,
      activo: v.activo,
      orden: v.orden,
    };
  }

  async actualizarVariante(
    id: string,
    dto: ActualizarVarianteDto,
    userId: string,
  ): Promise<VarianteDto> {
    const anterior = await this.varianteOFalla(id);

    const data: Prisma.ProductVariantUpdateInput = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.orden !== undefined) data.orden = dto.orden;

    const cambiaPrecio = dto.precioBolivianos !== undefined;
    const precioNuevo =
      dto.precioBolivianos !== undefined
        ? aCentavos(dto.precioBolivianos)
        : anterior.precio;

    if (cambiaPrecio) data.precio = precioNuevo;

    if (!cambiaPrecio || precioNuevo === anterior.precio) {
      const v = await this.prisma.productVariant.update({ where: { id }, data });
      return {
        id: v.id,
        nombre: v.nombre,
        precioCentavos: v.precio,
        activo: v.activo,
        orden: v.orden,
      };
    }

    // Igual que en producto: precio y auditoría en la misma transacción (D-07).
    const v = await this.prisma.$transaction(async (tx) => {
      const actualizada = await tx.productVariant.update({
        where: { id },
        data,
      });

      await tx.auditLog.create({
        data: {
          userId,
          productId: anterior.productId,
          accion: 'PRECIO_CAMBIADO',
          detalle: {
            entidad: 'variante',
            varianteId: id,
            nombre: actualizada.nombre,
            precioAnteriorCentavos: anterior.precio,
            precioNuevoCentavos: precioNuevo,
          },
        },
      });

      return actualizada;
    });

    return {
      id: v.id,
      nombre: v.nombre,
      precioCentavos: v.precio,
      activo: v.activo,
      orden: v.orden,
    };
  }

  /**
   * Desactivar la última variante activa devuelve el plato a precio simple.
   * Si no, el kiosco mostraría un plato con variantes y ninguna para elegir.
   */
  async cambiarActivoVariante(
    id: string,
    activo: boolean,
    userId: string,
  ): Promise<void> {
    const variante = await this.varianteOFalla(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.update({ where: { id }, data: { activo } });

      const activasRestantes = await tx.productVariant.count({
        where: { productId: variante.productId, activo: true },
      });

      await tx.product.update({
        where: { id: variante.productId },
        data: { tieneVariantes: activasRestantes > 0 },
      });

      await tx.auditLog.create({
        data: {
          userId,
          productId: variante.productId,
          accion: activo ? 'PRODUCTO_ACTIVADO' : 'PRODUCTO_DESACTIVADO',
          detalle: {
            entidad: 'variante',
            varianteId: id,
            nombre: variante.nombre,
          },
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // RQ-205 — Reordenar
  // -------------------------------------------------------------------------

  /**
   * El cliente manda el orden resultante completo, no índices relativos.
   * Fuente: S2 RQ-205. Así dos personas reordenando a la vez no producen un
   * orden intermedio inconsistente.
   *
   * El orden del menú es decisión comercial de la dueña: lo que quiere vender
   * va primero (PLAN §7).
   */
  async reordenarCategorias(ids: string[]): Promise<void> {
    await this.verificarIdsExisten('category', ids);
    await this.prisma.$transaction(
      ids.map((id, indice) =>
        this.prisma.category.update({
          where: { id },
          data: { orden: indice },
        }),
      ),
    );
  }

  async reordenarProductos(ids: string[]): Promise<void> {
    await this.verificarIdsExisten('product', ids);
    await this.prisma.$transaction(
      ids.map((id, indice) =>
        this.prisma.product.update({ where: { id }, data: { orden: indice } }),
      ),
    );
  }

  async reordenarVariantes(ids: string[]): Promise<void> {
    await this.verificarIdsExisten('variant', ids);
    await this.prisma.$transaction(
      ids.map((id, indice) =>
        this.prisma.productVariant.update({
          where: { id },
          data: { orden: indice },
        }),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Foto — RQ-206 (la parte de persistencia; el almacenamiento es ImageStorage)
  // -------------------------------------------------------------------------

  async asignarImagen(productId: string, imagenUrl: string): Promise<void> {
    await this.productoOFalla(productId);
    await this.prisma.product.update({
      where: { id: productId },
      data: { imagenUrl },
    });
  }

  // -------------------------------------------------------------------------
  // RQ-208 — Lo que orders necesita para el snapshot
  // -------------------------------------------------------------------------

  /**
   * Nombre y precio vigentes de un plato o variante, para que orders los copie
   * al OrderItem (PLAN §4, snapshot de precios).
   *
   * Validaciones que protegen a B7:
   *   - El plato debe estar activo: no se puede pedir algo agotado.
   *   - La variante debe pertenecer al plato. Sin esto, un cliente malicioso
   *     podría pedir el plato caro con el precio de la variante barata de otro
   *     producto (REPORTE CLI-02).
   */
  async datosParaSnapshot(
    productId: string,
    variantId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<{ nombre: string; precioCentavos: number }> {
    const cliente = tx ?? this.prisma;
    const producto = await cliente.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (producto === null) {
      throw new NotFoundException('El plato no existe');
    }
    if (!producto.activo) {
      throw new BadRequestException(`"${producto.nombre}" no está disponible`);
    }

    if (variantId === null) {
      if (producto.tieneVariantes) {
        throw new BadRequestException(
          `"${producto.nombre}" requiere elegir un tamaño`,
        );
      }
      return { nombre: producto.nombre, precioCentavos: producto.precioBase };
    }

    const variante = producto.variants.find((v) => v.id === variantId);
    if (variante === undefined) {
      throw new BadRequestException(
        'Esa opción no corresponde a este plato',
      );
    }
    if (!variante.activo) {
      throw new BadRequestException(
        `"${producto.nombre} ${variante.nombre}" no está disponible`,
      );
    }

    return {
      nombre: `${producto.nombre} ${variante.nombre}`,
      precioCentavos: variante.precio,
    };
  }

  // -------------------------------------------------------------------------
  // Auxiliares
  // -------------------------------------------------------------------------

  private async categoriaOFalla(id: string) {
    const c = await this.prisma.category.findUnique({ where: { id } });
    if (c === null) throw new NotFoundException('La categoría no existe');
    return c;
  }

  private async productoOFalla(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (p === null) throw new NotFoundException('El plato no existe');
    return p;
  }

  private async varianteOFalla(id: string) {
    const v = await this.prisma.productVariant.findUnique({ where: { id } });
    if (v === null) throw new NotFoundException('La opción no existe');
    return v;
  }

  private async verificarIdsExisten(
    tabla: 'category' | 'product' | 'variant',
    ids: string[],
  ): Promise<void> {
    const unicos = new Set(ids);
    if (unicos.size !== ids.length) {
      throw new BadRequestException('La lista tiene elementos repetidos');
    }

    const encontrados =
      tabla === 'category'
        ? await this.prisma.category.count({ where: { id: { in: ids } } })
        : tabla === 'product'
          ? await this.prisma.product.count({ where: { id: { in: ids } } })
          : await this.prisma.productVariant.count({
              where: { id: { in: ids } },
            });

    if (encontrados !== ids.length) {
      throw new BadRequestException(
        'Alguno de los elementos a reordenar no existe',
      );
    }
  }

  private async siguienteOrdenCategoria(): Promise<number> {
    const ultima = await this.prisma.category.findFirst({
      orderBy: { orden: 'desc' },
    });
    return (ultima?.orden ?? -1) + 1;
  }

  private async siguienteOrdenProducto(categoryId: string): Promise<number> {
    const ultimo = await this.prisma.product.findFirst({
      where: { categoryId },
      orderBy: { orden: 'desc' },
    });
    return (ultimo?.orden ?? -1) + 1;
  }

  private async siguienteOrdenVariante(productId: string): Promise<number> {
    const ultima = await this.prisma.productVariant.findFirst({
      where: { productId },
      orderBy: { orden: 'desc' },
    });
    return (ultima?.orden ?? -1) + 1;
  }

  private aProductoDto(p: {
    id: string;
    categoryId: string;
    nombre: string;
    descripcion: string | null;
    precioBase: number;
    imagenUrl: string | null;
    activo: boolean;
    orden: number;
    tieneVariantes: boolean;
    variants: Array<{
      id: string;
      nombre: string;
      precio: number;
      activo: boolean;
      orden: number;
    }>;
  }): ProductoDto {
    return {
      id: p.id,
      categoryId: p.categoryId,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precioCentavos: p.precioBase,
      imagenUrl: p.imagenUrl,
      activo: p.activo,
      orden: p.orden,
      tieneVariantes: p.tieneVariantes,
      variantes: p.variants.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        precioCentavos: v.precio,
        activo: v.activo,
        orden: v.orden,
      })),
    };
  }
}

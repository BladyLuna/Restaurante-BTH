/**
 * Endpoints de catálogo.
 * Fuente: PLAN §6, RQ-201 a RQ-210.
 *
 * Los permisos se declaran acá, sobre la ruta, no dentro del servicio
 * (ARQUITECTURA §6): un `if (rol === ADMIN)` enterrado en un método es
 * invisible al leer el endpoint.
 *
 * Quién puede qué:
 *   GET /catalog        público — lo usa el kiosco, token de dispositivo
 *   todo lo demás       ADMIN — la carta es decisión comercial de la dueña
 */

import {
  Controller,
  Inject,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { CatalogSchemas } from '@restaurante/shared';
import { Publico, Roles } from '../auth/auth.guard.js';
import { Usuario } from '../auth/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/auth.service.js';
import {
  CatalogService,
  type CategoriaDto,
  type ProductoDto,
  type VarianteDto,
} from './catalog.service.js';
import type { ZodType } from 'zod';

/**
 * Valida con Zod y traduce el error a un mensaje que el panel pueda mostrar.
 * El schema es el mismo que usa el cliente (PLAN §6).
 */
function validar<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const primero = r.error.errors[0];
    throw new BadRequestException(primero?.message ?? 'Datos inválidos');
  }
  return r.data;
}

@Controller()
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  // -------------------------------------------------------------------------
  // RQ-210 — Público, para el kiosco
  // -------------------------------------------------------------------------

  @Publico()
  @Get('catalog')
  async catalogoPublico(): Promise<CategoriaDto[]> {
    return this.catalog.catalogoPublico();
  }

  // -------------------------------------------------------------------------
  // Panel
  // -------------------------------------------------------------------------

  @Roles('ADMIN')
  @Get('admin/catalog')
  async catalogoAdmin(): Promise<CategoriaDto[]> {
    return this.catalog.catalogoAdmin();
  }

  // --- Categorías — RQ-201 -------------------------------------------------

  @Roles('ADMIN')
  @Post('admin/categories')
  async crearCategoria(@Body() body: unknown): Promise<CategoriaDto> {
    return this.catalog.crearCategoria(
      validar(CatalogSchemas.CrearCategoria, body),
    );
  }

  @Roles('ADMIN')
  @Put('admin/categories/:id')
  async actualizarCategoria(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CategoriaDto> {
    return this.catalog.actualizarCategoria(
      id,
      validar(CatalogSchemas.ActualizarCategoria, body),
    );
  }

  /** RQ-204 — Nunca hay DELETE. Se desactiva. */
  @Roles('ADMIN')
  @Patch('admin/categories/:id/activo')
  @HttpCode(204)
  async activoCategoria(
    @Param('id') id: string,
    @Body() body: unknown,
    @Usuario() usuario: UsuarioAutenticado,
  ): Promise<void> {
    const dto = validar(CatalogSchemas.CambiarActivo, body);
    await this.catalog.cambiarActivoCategoria(id, dto.activo, usuario.id);
  }

  /** RQ-205 — El cliente manda el orden resultante completo. */
  @Roles('ADMIN')
  @Post('admin/categories/reordenar')
  @HttpCode(204)
  async reordenarCategorias(@Body() body: unknown): Promise<void> {
    const dto = validar(CatalogSchemas.Reordenar, body);
    await this.catalog.reordenarCategorias(dto.ids);
  }

  // --- Platos — RQ-202 -----------------------------------------------------

  @Roles('ADMIN')
  @Post('admin/products')
  async crearProducto(@Body() body: unknown): Promise<ProductoDto> {
    return this.catalog.crearProducto(
      validar(CatalogSchemas.CrearProducto, body),
    );
  }

  /** RQ-209 — Si cambia el precio, se audita en la misma transacción. */
  @Roles('ADMIN')
  @Put('admin/products/:id')
  async actualizarProducto(
    @Param('id') id: string,
    @Body() body: unknown,
    @Usuario() usuario: UsuarioAutenticado,
  ): Promise<ProductoDto> {
    return this.catalog.actualizarProducto(
      id,
      validar(CatalogSchemas.ActualizarProducto, body),
      usuario.id,
    );
  }

  /**
   * RQ-204 — La acción más frecuente del día: se acabó el pollo.
   * Un solo toque, sin confirmación, porque es reversible (PLAN §7).
   */
  @Roles('ADMIN')
  @Patch('admin/products/:id/activo')
  @HttpCode(204)
  async activoProducto(
    @Param('id') id: string,
    @Body() body: unknown,
    @Usuario() usuario: UsuarioAutenticado,
  ): Promise<void> {
    const dto = validar(CatalogSchemas.CambiarActivo, body);
    await this.catalog.cambiarActivoProducto(id, dto.activo, usuario.id);
  }

  @Roles('ADMIN')
  @Post('admin/products/reordenar')
  @HttpCode(204)
  async reordenarProductos(@Body() body: unknown): Promise<void> {
    const dto = validar(CatalogSchemas.Reordenar, body);
    await this.catalog.reordenarProductos(dto.ids);
  }

  // --- Variantes — RQ-203 --------------------------------------------------

  @Roles('ADMIN')
  @Post('admin/products/:productId/variants')
  async crearVariante(
    @Param('productId') productId: string,
    @Body() body: unknown,
  ): Promise<VarianteDto> {
    return this.catalog.crearVariante(
      productId,
      validar(CatalogSchemas.CrearVariante, body),
    );
  }

  @Roles('ADMIN')
  @Put('admin/variants/:id')
  async actualizarVariante(
    @Param('id') id: string,
    @Body() body: unknown,
    @Usuario() usuario: UsuarioAutenticado,
  ): Promise<VarianteDto> {
    return this.catalog.actualizarVariante(
      id,
      validar(CatalogSchemas.ActualizarVariante, body),
      usuario.id,
    );
  }

  @Roles('ADMIN')
  @Patch('admin/variants/:id/activo')
  @HttpCode(204)
  async activoVariante(
    @Param('id') id: string,
    @Body() body: unknown,
    @Usuario() usuario: UsuarioAutenticado,
  ): Promise<void> {
    const dto = validar(CatalogSchemas.CambiarActivo, body);
    await this.catalog.cambiarActivoVariante(id, dto.activo, usuario.id);
  }

  @Roles('ADMIN')
  @Post('admin/variants/reordenar')
  @HttpCode(204)
  async reordenarVariantes(@Body() body: unknown): Promise<void> {
    const dto = validar(CatalogSchemas.Reordenar, body);
    await this.catalog.reordenarVariantes(dto.ids);
  }
}

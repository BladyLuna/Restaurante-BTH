/**
 * RQ-115 — Módulo locations (B4)
 *
 * Fuente: MODULOS §0.
 *
 * No construimos multi-tenancy. Lo que hacemos es no cerrarnos la puerta: toda
 * fila que pertenece a un local lleva locationId desde el día uno. El día que
 * haya un segundo local, el trabajo es UI y reportes, no una migración de
 * esquema con datos de producción adentro.
 */

import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service.js';

export type LocationDto = {
  id: string;
  nombre: string;
  activo: boolean;
};

@Injectable()
export class LocationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listar(): Promise<LocationDto[]> {
    const filas = await this.prisma.location.findMany({
      where: { activo: true },
      orderBy: { creadoEn: 'asc' },
    });
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      activo: f.activo,
    }));
  }

  async obtener(id: string): Promise<LocationDto> {
    const fila = await this.prisma.location.findUnique({ where: { id } });
    if (fila === null) {
      throw new NotFoundException('Local no encontrado');
    }
    return { id: fila.id, nombre: fila.nombre, activo: fila.activo };
  }

  /**
   * El local por defecto. Mientras haya uno solo, todo el sistema lo usa.
   * Cuando haya dos, esta función deja de tener sentido y los llamadores pasan
   * a recibir el locationId del usuario autenticado — que ya existe en el JWT.
   */
  async porDefecto(): Promise<LocationDto> {
    const fila = await this.prisma.location.findFirst({
      where: { activo: true },
      orderBy: { creadoEn: 'asc' },
    });
    if (fila === null) {
      throw new NotFoundException(
        'No hay ningún local activo. Corré el seed: npx tsx prisma/seed.ts',
      );
    }
    return { id: fila.id, nombre: fila.nombre, activo: fila.activo };
  }
}

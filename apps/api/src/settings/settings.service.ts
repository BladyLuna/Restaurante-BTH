/**
 * B5 — branding del local (nombre + logo)
 *
 * Fuente: ARQUITECTURA §1, §2; PLAN §5c (auditoría), §5g (permisos).
 *
 * POR QUÉ EL LOGO VA EN `Setting` Y NO EN UNA TABLA/COLUMNA NUEVA
 * ----------------------------------------------------------------
 * ARQUITECTURA §1 es explícita: "la configuración vive en tabla, no en .env,
 * para que la dueña pueda cambiarla sin reiniciar nada". El logo es
 * configuración del local, igual que `jornada.hora_corte`. `Setting.valor` es
 * `Json`, así que admite el objeto `{ mime, base64, version, bytes }` sin
 * migración alguna. No hace falta crear ninguna migración Prisma.
 *
 * POR QUÉ LOS BYTES VAN EN LA BASE Y NO EN DISCO
 * ----------------------------------------------
 * Guardar el archivo en disco obligaría a elegir un nombre de archivo, y el
 * único nombre disponible sería el que manda el cliente — exactamente el
 * vector de path traversal que hay que evitar. Guardando los bytes en la fila
 * de configuración el servidor nunca toca el filesystem: no hay nombre de
 * archivo, no hay ruta que escapar, no hay directorio que quede huérfano al
 * restaurar un backup de la base. Un logo son ~100 kB y se lee una vez por
 * arranque de kiosco; el costo es irrelevante y la superficie de ataque baja a
 * cero. El tope duro de 2 MB (LOGO_MAX_BYTES) impide que esto se convierta en
 * un almacén de imágenes por la ventana.
 *
 * SE VALIDA EL CONTENIDO, NO LO QUE DICE EL CLIENTE
 * -------------------------------------------------
 * El `mime` declarado se usa solo para elegir qué firma binaria exigir. Si el
 * cliente dice "image/png" y los primeros bytes no son la firma PNG, se
 * rechaza. Un `.png` que en realidad es un script no pasa.
 */

import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  LOGO_MAX_BYTES,
  type ActualizarBrandingDto,
  type BrandingDto,
  type LogoSubidoDto,
  type MimeLogo,
} from '@restaurante/shared';
import { PrismaService } from '../infra/prisma.service.js';
import { validarImagen } from '../infra/imagen.js';
import type { UsuarioAutenticado } from '../auth/auth.service.js';

export const CLAVE_NOMBRE = 'local.nombre';
export const CLAVE_LOGO = 'local.logo';

/**
 * Nombre por defecto si la dueña todavía no configuró nada. El kiosco necesita
 * algo que pintar en el encabezado desde el primer arranque; devolver null lo
 * dejaría con un hueco.
 */
export const NOMBRE_POR_DEFECTO = 'Mi Restaurante';

/** Ruta pública del logo. Relativa: el cliente hace API_URL + esto. */
const RUTA_LOGO = '/settings/branding/logo';

/**
 * Firmas binarias de los formatos aceptados.
 *
 * WEBP es un contenedor RIFF: "RIFF" + 4 bytes de tamaño + "WEBP", así que se
 * verifica en dos tramos salteando el tamaño.
 */
const FIRMAS: Record<MimeLogo, (b: Buffer) => boolean> = {
  'image/png': (b) =>
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) =>
    b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Logo tal como queda guardado en `Setting.valor`. */
type LogoGuardado = {
  mime: MimeLogo;
  base64: string;
  /** Hash del contenido. Va en la URL para invalidar la caché del cliente. */
  version: string;
  bytes: number;
};

export type LogoServible = {
  mime: MimeLogo;
  contenido: Buffer;
  version: string;
};

function esLogoGuardado(valor: unknown): valor is LogoGuardado {
  if (typeof valor !== 'object' || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v['mime'] === 'string' &&
    v['mime'] in FIRMAS &&
    typeof v['base64'] === 'string' &&
    typeof v['version'] === 'string'
  );
}

@Injectable()
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Lectura pública — la consume el kiosco, sin sesión
  // -------------------------------------------------------------------------

  async branding(): Promise<BrandingDto> {
    const [nombre, logo] = await Promise.all([
      this.prisma.setting.findUnique({ where: { clave: CLAVE_NOMBRE } }),
      this.prisma.setting.findUnique({ where: { clave: CLAVE_LOGO } }),
    ]);

    return {
      nombreLocal:
        typeof nombre?.valor === 'string' && nombre.valor.trim() !== ''
          ? nombre.valor
          : NOMBRE_POR_DEFECTO,
      logoUrl: esLogoGuardado(logo?.valor)
        ? `${RUTA_LOGO}?v=${logo.valor.version}`
        : null,
    };
  }

  /**
   * Bytes del logo para servirlo por HTTP. 404 si no hay logo: no se inventa
   * un placeholder, porque un placeholder silencioso haría creer a la dueña
   * que su logo se subió.
   */
  async logo(): Promise<LogoServible> {
    const fila = await this.prisma.setting.findUnique({ where: { clave: CLAVE_LOGO } });
    if (!esLogoGuardado(fila?.valor)) {
      throw new NotFoundException('Todavía no hay un logo cargado');
    }
    return {
      mime: fila.valor.mime,
      contenido: Buffer.from(fila.valor.base64, 'base64'),
      version: fila.valor.version,
    };
  }

  // -------------------------------------------------------------------------
  // Escritura — solo ADMIN (el controller lo declara con @Roles)
  // -------------------------------------------------------------------------

  /**
   * Cambia nombre y/o logo. Los dos campos son independientes: cambiar el logo
   * no toca el nombre.
   *
   * El cambio y su fila de auditoría se escriben en la MISMA transacción
   * (PLAN §5c): si se auditara después del commit y el proceso se reiniciara
   * en esa ventana, quedaría una configuración cambiada sin autor.
   */
  async actualizarBranding(
    dto: ActualizarBrandingDto,
    usuario: UsuarioAutenticado,
    ip: string | undefined,
  ): Promise<BrandingDto> {
    const antes = await this.branding();

    // Se valida ANTES de abrir la transacción: decodificar y verificar la
    // firma no necesita la base, y una transacción abierta mientras se
    // procesan megabytes retiene una conexión del pool sin razón.
    const nuevoLogo =
      dto.logo === undefined || dto.logo === null ? dto.logo : prepararLogo(dto.logo);

    const campos: string[] = [];
    if (dto.nombreLocal !== undefined) campos.push('nombreLocal');
    if (dto.logo !== undefined) campos.push('logo');

    const detalle: Prisma.JsonObject = { campos };
    if (dto.nombreLocal !== undefined) {
      detalle['nombreLocal'] = {
        anterior: antes.nombreLocal === NOMBRE_POR_DEFECTO ? null : antes.nombreLocal,
        nuevo: dto.nombreLocal,
      };
    }
    if (dto.logo !== undefined) {
      // Metadatos, nunca la imagen: un AuditLog con 2 MB de base64 por cambio
      // es una tabla de auditoría inservible.
      detalle['logo'] =
        nuevoLogo === null
          ? { accion: 'quitado', anteriorPresente: antes.logoUrl !== null }
          : {
              accion: 'subido',
              mime: nuevoLogo?.mime,
              bytes: nuevoLogo?.bytes,
              version: nuevoLogo?.version,
              anteriorPresente: antes.logoUrl !== null,
            };
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.nombreLocal !== undefined) {
        await tx.setting.upsert({
          where: { clave: CLAVE_NOMBRE },
          create: { clave: CLAVE_NOMBRE, valor: dto.nombreLocal },
          update: { valor: dto.nombreLocal },
        });
      }

      if (nuevoLogo === null) {
        await tx.setting.deleteMany({ where: { clave: CLAVE_LOGO } });
      } else if (nuevoLogo !== undefined) {
        const valor = nuevoLogo as unknown as Prisma.InputJsonObject;
        await tx.setting.upsert({
          where: { clave: CLAVE_LOGO },
          create: { clave: CLAVE_LOGO, valor },
          update: { valor },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: usuario.id,
          accion: 'CONFIGURACION_CAMBIADA',
          detalle,
          ip: ip ?? null,
        },
      });
    });

    return this.branding();
  }
}

/**
 * Decodifica y valida el logo, reusando la validación compartida con las fotos
 * de platos (`infra/imagen.ts`). Las firmas binarias viven en un solo lugar.
 */
function prepararLogo(logo: LogoSubidoDto): LogoGuardado {
  const v = validarImagen(logo, LOGO_MAX_BYTES, 'el logo');
  return {
    mime: v.mime as MimeLogo,
    base64: v.base64,
    version: v.version,
    bytes: v.bytes,
  };
}

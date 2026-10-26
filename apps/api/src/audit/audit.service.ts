/**
 * B10 — audit (lectura)
 *
 * Fuente: PLAN §5c, §7; D-07; ARQUITECTURA §2.
 *
 * Este módulo SOLO LEE. La escritura del log vive dentro de cada transacción
 * que la origina (catalog, payments, kitchen, auth) y ahí se queda: centralizar
 * la escritura acá obligaría a pasar el `tx` de Prisma entre servicios, o peor,
 * a escribir por evento después del commit — que es exactamente lo que D-07
 * prohíbe, porque un reinicio en esa ventana dejaría un precio cambiado sin
 * autor.
 *
 * Profundidad de slice: controller → service → Prisma directo, sin repositorio
 * (ARQUITECTURA §2). No hay lógica que proteger, solo consulta y traducción.
 *
 * Tres decisiones de rendimiento, porque este log crece sin techo (cada login
 * fallido escribe una fila) y una pantalla lenta se vuelve más lenta cada día:
 *
 *   1. PAGINACIÓN POR CURSOR, no `skip`/`offset`. Con offset, la página 20
 *      obliga a Postgres a leer y descartar 500 filas; el costo crece con el
 *      número de página. Con cursor sobre `creadoEn` es un seek directo al
 *      índice, constante sin importar cuán atrás se vaya.
 *
 *   2. VENTANA TEMPORAL OBLIGATORIA (7 días por defecto, 90 de techo). Sin
 *      `where` sobre `creadoEn` la consulta escanea la tabla entera. El índice
 *      `@@index([creadoEn])` del esquema existe para esto.
 *
 *   3. CONTADORES CON `groupBy`, no trayendo filas. Los números de las pestañas
 *      salen de un agregado que Postgres resuelve contra el índice
 *      `(accion, creadoEn)`; traer 4000 filas para contarlas en JS sería mover
 *      megabytes para mostrar cuatro números.
 *
 * Y una de producto: EL TEXTO SE ARMA EN EL SERVIDOR. Si cada cliente armara
 * la frase, el mismo evento se leería distinto en el celular de la dueña y en
 * la laptop de caja. Un reporte que se lee distinto según el dispositivo no
 * sirve para resolver una discusión sobre dinero.
 */

import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACCIONES_POR_GRUPO,
  AUDITORIA_POR_PAGINA,
  type ConsultarAuditoriaDto,
  type EntradaAuditoriaDto,
  type GrupoAuditoria,
  type ReporteAuditoriaDto,
} from '@restaurante/shared';
import { PrismaService } from '../infra/prisma.service.js';

/** Centavos → "Bs 35". Los montos son bolivianos enteros (D-04). */
function bs(centavos: number | null): string {
  if (centavos === null) return '—';
  return `Bs ${Math.round(centavos / 100)}`;
}

/** Índice inverso acción → grupo, construido una vez al cargar el módulo. */
const GRUPO_DE_ACCION = new Map<string, GrupoAuditoria>();
for (const [grupo, acciones] of Object.entries(ACCIONES_POR_GRUPO)) {
  for (const accion of acciones) {
    GRUPO_DE_ACCION.set(accion, grupo as GrupoAuditoria);
  }
}

/**
 * Lo que el servicio selecciona de la base.
 *
 * `select` explícito y no `include`: traer el `User` completo arrastraría
 * `pinHash` hasta la capa de presentación. Un hash de PIN no tiene por qué
 * salir de su servicio, ni siquiera en memoria.
 */
const SELECCION = {
  id: true,
  accion: true,
  creadoEn: true,
  montoEsperado: true,
  montoRecibido: true,
  detalle: true,
  user: { select: { nombre: true, rol: true } },
  targetUser: { select: { nombre: true } },
  order: { select: { numero: true } },
} satisfies Prisma.AuditLogSelect;

type FilaAuditoria = Prisma.AuditLogGetPayload<{ select: typeof SELECCION }>;

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async reporte(dto: ConsultarAuditoriaDto): Promise<ReporteAuditoriaDto> {
    const desde = new Date(Date.now() - dto.dias * 24 * 60 * 60 * 1000);

    const where: Prisma.AuditLogWhereInput = {
      // Siempre acotado por fecha: sin esto se escanea la tabla entera.
      creadoEn: dto.cursor
        ? { gte: desde, lt: new Date(dto.cursor) }
        : { gte: desde },
    };

    if (dto.grupo !== 'TODO') {
      // El `as` existe solo para que el array `as const` de shared encaje con
      // el enum que genera Prisma. Son exactamente los mismos valores: shared
      // no puede importar tipos de Prisma (regla 1 del kernel compartido).
      where.accion = {
        in: ACCIONES_POR_GRUPO[dto.grupo] as unknown as FilaAuditoria['accion'][],
      };
    }

    // Las dos consultas son independientes: van en paralelo, no en serie.
    const [filas, conteos] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: SELECCION,
        orderBy: { creadoEn: 'desc' },
        // Una fila extra para saber si hay página siguiente sin un COUNT(*)
        // aparte. El COUNT sobre el rango completo costaría un escaneo que la
        // fila extra evita.
        take: AUDITORIA_POR_PAGINA + 1,
      }),
      this.prisma.auditLog.groupBy({
        by: ['accion'],
        where: { creadoEn: { gte: desde } },
        _count: { _all: true },
      }),
    ]);

    const hayMas = filas.length > AUDITORIA_POR_PAGINA;
    const pagina = hayMas ? filas.slice(0, AUDITORIA_POR_PAGINA) : filas;
    const ultima = pagina.at(-1);

    const totales = { DINERO: 0, CARTA: 0, ACCESOS: 0, TODO: 0 };
    for (const c of conteos) {
      const n = c._count._all;
      totales.TODO += n;
      const grupo = GRUPO_DE_ACCION.get(c.accion);
      if (grupo && grupo !== 'TODO') totales[grupo] += n;
    }

    return {
      entradas: pagina.map((f) => this.presentar(f)),
      siguienteCursor:
        hayMas && ultima ? ultima.creadoEn.toISOString() : null,
      totales,
    };
  }

  /** Traduce una fila cruda a la línea que lee la dueña. */
  private presentar(f: FilaAuditoria): EntradaAuditoriaDto {
    return {
      id: f.id,
      accion: f.accion,
      grupo: GRUPO_DE_ACCION.get(f.accion) ?? 'TODO',
      resumen: this.resumir(f),
      autor: f.user?.nombre ?? null,
      rolAutor: f.user?.rol ?? null,
      creadoEn: f.creadoEn.toISOString(),
      numeroPedido: f.order?.numero ?? null,
      montoEsperado: f.montoEsperado,
      montoRecibido: f.montoRecibido,
    };
  }

  /**
   * La frase en lenguaje llano.
   *
   * Cada caso describe la consecuencia para el negocio, no el cambio de datos.
   * "Cambió el precio de Pollo: Bs 35 → Bs 40" le sirve a la dueña; "UPDATE
   * products SET precio_base" no.
   */
  private resumir(f: FilaAuditoria): string {
    const d = (f.detalle ?? {}) as Record<string, unknown>;
    const nombre = typeof d.nombre === 'string' ? d.nombre : null;
    const pedido = f.order ? `pedido #${f.order.numero}` : 'un pedido';

    switch (f.accion) {
      case 'PRECIO_CAMBIADO': {
        const antes = bs(Number(d.precioAnteriorCentavos ?? 0) || null);
        const ahora = bs(Number(d.precioNuevoCentavos ?? 0) || null);
        const que = typeof d.entidad === 'string' ? d.entidad : 'plato';
        return `Cambió el precio del ${que} "${nombre ?? '—'}": ${antes} → ${ahora}`;
      }
      case 'PRODUCTO_ACTIVADO':
        return `Volvió a ofrecer "${nombre ?? '—'}"`;
      case 'PRODUCTO_DESACTIVADO':
        return `Dejó de ofrecer "${nombre ?? '—'}" (se agotó o salió de la carta)`;
      case 'PAGO_CONFIRMADO':
        return `Confirmó el pago del ${pedido} por ${bs(f.montoRecibido)}`;
      case 'PAGO_CONFIRMADO_CON_DIFERENCIA':
        return `Confirmó el ${pedido} con diferencia: esperaba ${bs(f.montoEsperado)}, entró ${bs(f.montoRecibido)}`;
      case 'PEDIDO_CANCELADO':
        return `Canceló el ${pedido}${typeof d.motivo === 'string' ? ` — ${d.motivo}` : ''}`;
      case 'PEDIDO_ENTREGADO':
        return `Entregó el ${pedido}`;
      case 'REFUND_CREADO':
        return `Quedó pendiente devolver ${bs(f.montoRecibido)} del ${pedido}`;
      case 'REFUND_CERRADO':
        return `Cerró la devolución del ${pedido}`;
      case 'QR_SUBIDO':
        return 'Cargó un QR de cobro nuevo';
      case 'QR_ACTIVADO':
        return 'Puso en uso otro QR de cobro';
      case 'QR_ARCHIVADO':
        return 'Archivó un QR de cobro';
      case 'COMPROBANTE_ADJUNTADO':
        return `Adjuntó el comprobante del ${pedido} como evidencia`;
      case 'CONFIGURACION_CAMBIADA':
        return `Cambió la configuración del local${nombre ? `: ${nombre}` : ''}`;
      case 'USUARIO_CREADO':
        return `Dio de alta a ${f.targetUser?.nombre ?? 'un usuario'}`;
      case 'USUARIO_DESACTIVADO':
        return `Dio de baja a ${f.targetUser?.nombre ?? 'un usuario'}`;
      case 'PERMISO_OTORGADO':
        return `Le dio más permisos a ${f.targetUser?.nombre ?? 'un usuario'}`;
      case 'PERMISO_REVOCADO':
        return `Le quitó permisos a ${f.targetUser?.nombre ?? 'un usuario'}`;
      case 'PIN_RESETEADO':
        return `Cambió el PIN de ${f.targetUser?.nombre ?? 'un usuario'}`;
      case 'LOGIN_FALLIDO':
        return 'Alguien intentó entrar con un PIN equivocado';
      case 'LOGIN_BLOQUEADO':
        return 'Se bloqueó el acceso por demasiados intentos fallidos';
      default:
        // Inalcanzable hoy: el switch cubre el enum completo, y por eso acá
        // TypeScript estrecha `accion` a `never`. Se deja igual porque el enum
        // de Prisma puede crecer en una migración futura y es mejor que el
        // reporte muestre la acción cruda que romperse.
        return String(f.accion).replaceAll('_', ' ').toLowerCase();
    }
  }
}

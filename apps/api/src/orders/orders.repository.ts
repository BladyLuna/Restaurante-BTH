/**
 * B7 — `orders.repository`
 *
 * Fuente: `ARQUITECTURA §2` (slice completo con repositorio), `PLAN §4`,
 * `REPORTE SIS-02`.
 *
 * `orders` es uno de los dos slices con repositorio, porque tiene reglas reales
 * —numeración transaccional, idempotencia— que conviene aislar del servicio.
 * Es lo contrario de `catalog` (S2), que va directo a Prisma.
 *
 * Todos los métodos reciben el cliente transaccional (`tx`) en vez de usar el
 * global: la numeración y la creación del pedido tienen que ocurrir en la misma
 * transacción o el número se duplica (`PLAN §4`).
 */

import { Injectable, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service.js';

/** El cliente de Prisma dentro de una transacción. */
export type Tx = Prisma.TransactionClient;

@Injectable()
export class OrdersRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * RQ-302 — Siguiente número de pedido de la jornada.
   *
   * `SELECT ... FOR UPDATE` dentro de la transacción que crea el pedido
   * (`PLAN §4`). Garantiza números consecutivos **sin huecos ni duplicados**.
   *
   * El `INSERT ... ON CONFLICT DO UPDATE` resuelve dos problemas a la vez:
   *
   * 1. La primera fila del contador del día. `REPORTE SIS-02` lo deja como
   *    pendiente: dos pedidos simultáneos al abrir la jornada no deben duplicar
   *    la fila de `OrderCounter`. Un `SELECT` seguido de `INSERT` tendría una
   *    ventana entre ambos; el upsert atómico no.
   * 2. El incremento con bloqueo. `ON CONFLICT DO UPDATE` toma un lock de fila
   *    en la fila existente, así que el segundo pedido simultáneo espera al
   *    primero en vez de leer el mismo valor.
   *
   * El número es único por `(fecha, locationId)`, no global
   * (`ARQUITECTURA §1`). Hoy hay un local, pero la clave compuesta ya existe.
   */
  async siguienteNumero(
    tx: Tx,
    locationId: string,
    fecha: Date,
  ): Promise<number> {
    const filas = await tx.$queryRaw<{ ultimoNumero: number }[]>`
      INSERT INTO order_counters ("locationId", fecha, "ultimoNumero")
      VALUES (${locationId}, ${fecha}::date, 1)
      ON CONFLICT ("locationId", fecha)
      DO UPDATE SET "ultimoNumero" = order_counters."ultimoNumero" + 1
      RETURNING "ultimoNumero"
    `;

    const numero = filas[0]?.ultimoNumero;
    if (numero === undefined) {
      throw new Error('El contador de pedidos no devolvió número');
    }
    return numero;
  }

  /**
   * RQ-303 — Busca un pedido por el UUID del intento.
   *
   * Si existe, el `POST` fue un reintento y hay que devolver el pedido ya
   * creado en lugar de crear un segundo (`ARQUITECTURA §7`).
   */
  async porIntentoUuid(intentoUuid: string, tx?: Tx) {
    const cliente = tx ?? this.prisma;
    return cliente.order.findUnique({
      where: { intentoUuid },
      include: { items: true, paymentQr: { select: { imagenUrl: true } } },
    });
  }

  async porId(id: string, tx?: Tx) {
    const cliente = tx ?? this.prisma;
    return cliente.order.findUnique({
      where: { id },
      include: { items: true, paymentQr: { select: { imagenUrl: true } } },
    });
  }

  /** El QR activo del local, para asociarlo al pedido (`PLAN §5b`). */
  async qrActivo(tx: Tx, locationId: string) {
    return tx.paymentQr.findFirst({
      where: { locationId, activo: true, archivado: false },
    });
  }

  /**
   * Pedidos que pasaron el timeout y siguen esperando pago.
   *
   * No se filtra por fecha: un pedido de ayer que quedó pendiente también tiene
   * que cancelarse.
   */
  async pendientesVencidos(limite: Date, locationId?: string) {
    return this.prisma.order.findMany({
      where: {
        estado: 'PENDIENTE_PAGO',
        creadoEn: { lt: limite },
        ...(locationId ? { locationId } : {}),
      },
      select: { id: true, numero: true, locationId: true, total: true },
    });
  }

  /** Lee un valor de `Setting` (RQ-109): la configuración no vive en `.env`. */
  async setting<T>(clave: string, porDefecto: T): Promise<T> {
    const fila = await this.prisma.setting.findUnique({ where: { clave } });
    return fila === null ? porDefecto : (fila.valor as T);
  }
}

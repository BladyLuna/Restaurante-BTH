/**
 * B7 — orders.service
 *
 * Fuente: `PLAN §4`, `PLAN §6`, `PLAN §7`, `ARQUITECTURA §2`, `ARQUITECTURA §7`,
 * D-04, D-12, D-13, D-14, `REPORTE SIS-02`, `REPORTE CLI-02`.
 *
 * Tres reglas gobiernan este archivo:
 *
 *   1. EL TOTAL SE RECALCULA SIEMPRE EN EL SERVIDOR (RQ-304, `PLAN §6`).
 *      Lo que manda la tablet se ignora. No se compara con el propio: comparar
 *      convertiría un dato no confiable en parte de la decisión.
 *
 *   2. EL PRECIO SE CONGELA AL PEDIR (RQ-305, `ARQUITECTURA §5`). Si la dueña
 *      sube el precio mientras el cliente está pagando, el pedido mantiene el
 *      precio que vio. Por eso `OrderItem` guarda `nombreSnapshot` y
 *      `precioUnitarioSnapshot`.
 *
 *   3. CREAR UN PEDIDO ES UNA SOLA TRANSACCIÓN (RQ-302, `PLAN §4`). Numerar,
 *      resolver precios e insertar ocurren juntos o no ocurren. Si numerar
 *      quedara fuera, dos pedidos simultáneos tomarían el mismo número.
 */

import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, type EstadoPedido } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { LocationsService } from '../locations/locations.service.js';
import { OrdersRepository, type Tx } from './orders.repository.js';
import { armarPedido, type ItemResuelto } from './domain/armar-pedido.js';
import { jornadaDe, HORA_CORTE_POR_DEFECTO } from './domain/jornada.js';
import {
  Result,
  describirErrorCalculo,
  puedeTransicionar,
  type CrearPedidoDto,
} from '@restaurante/shared';

/** RQ-306 — Ventana de pago. El valor real sale de `Setting` (RQ-109). */
const MINUTOS_EXPIRACION_POR_DEFECTO = 15;

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrdersRepository) private readonly repo: OrdersRepository,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(LocationsService) private readonly locations: LocationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // RQ-301 a RQ-305 — Crear un pedido
  // ---------------------------------------------------------------------------

  /**
   * Crea un pedido desde el kiosco. Ruta pública: el cliente no se autentica
   * (`PLAN §7`).
   *
   * RQ-303 — Idempotencia. El chequeo del `intentoUuid` se hace DOS veces: una
   * antes de la transacción (camino rápido del reintento normal) y otra dentro,
   * por si dos reintentos llegan a la vez. La segunda es la que vale; la
   * primera solo evita abrir una transacción al vacío.
   *
   * Si las dos pasaran y el UUID ya existiera, el `UNIQUE` de la base aborta el
   * insert. Esa es la última línea de defensa y es la única que no depende del
   * código de la aplicación (`ARQUITECTURA §7`).
   */
  async crear(dto: CrearPedidoDto, ip?: string) {
    const yaExiste = await this.repo.porIntentoUuid(dto.intentoUuid);
    if (yaExiste !== null) {
      return this.presentar(yaExiste);
    }

    const location = await this.locations.porDefecto();
    const horaCorte = await this.repo.setting<number>(
      'hora_corte_jornada',
      HORA_CORTE_POR_DEFECTO,
    );

    try {
      return await this.crearEnTransaccion(dto, location.id, horaCorte);
    } catch (e) {
      // P2002 sobre intentoUuid: dos reintentos del MISMO intento entraron a la
      // vez. Cada transacción chequeó el UUID y ninguna vio el insert de la
      // otra (todavía sin commitear, nivel READ COMMITTED), así que el UNIQUE
      // de la base frenó al segundo. Ese es su trabajo (`ARQUITECTURA §7`).
      //
      // Pero el cliente no debe ver un 500: pidió una vez y hay exactamente un
      // pedido. Se relee y se devuelve el que ganó la carrera.
      //
      // Se captura solo este caso concreto. Cualquier otro error sube: tragarlo
      // esconderia un problema real detrás de una respuesta que parece exitosa.
      if (this.esChoqueDeIntento(e)) {
        const ganador = await this.repo.porIntentoUuid(dto.intentoUuid);
        if (ganador !== null) {
          return this.presentar(ganador);
        }
      }
      throw e;
    }
  }

  /** `true` si el error es la violación del UNIQUE de `intentoUuid`. */
  private esChoqueDeIntento(e: unknown): boolean {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
    const err = e as Prisma.PrismaClientKnownRequestError;
    if (err.code !== 'P2002') return false;
    const target = err.meta?.target;
    const campos = Array.isArray(target) ? target : [target];
    return campos.some((c) => String(c).includes('intentoUuid'));
  }

  private async crearEnTransaccion(
    dto: CrearPedidoDto,
    locationId: string,
    horaCorte: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Segundo chequeo, ahora dentro de la transacción.
      const reintento = await this.repo.porIntentoUuid(dto.intentoUuid, tx);
      if (reintento !== null) {
        return this.presentar(reintento);
      }

      // Los precios se resuelven DENTRO de la transacción: si la dueña cambia
      // un precio justo ahora, o se lee el de antes o el de después, nunca una
      // mezcla de los dos.
      const resueltos: ItemResuelto[] = [];
      for (const item of dto.items) {
        const variantId = item.variantId ?? null;
        // datosParaSnapshot rechaza el ataque CLI-02: pedir un plato caro con
        // el id de una variante barata de otro producto. También rechaza platos
        // desactivados y platos con variantes sin elegir tamaño (RQ-208).
        const snapshot = await this.catalog.datosParaSnapshot(
          item.productId,
          variantId,
          tx,
        );
        resueltos.push({
          productId: item.productId,
          variantId,
          cantidad: item.cantidad,
          notas: item.notas ?? null,
          snapshot,
        });
      }

      const armado = armarPedido(resueltos);
      if (Result.isErr(armado)) {
        // El dominio devuelve Result; acá se traduce a HTTP. El mensaje sale de
        // describirErrorCalculo (S1) para que el texto viva en un solo lugar.
        throw new BadRequestException(describirErrorCalculo(armado.error));
      }

      const fecha = jornadaDe(new Date(), horaCorte);
      const numero = await this.repo.siguienteNumero(tx, locationId, fecha);
      const qr = await this.repo.qrActivo(tx, locationId);

      const pedido = await tx.order.create({
        data: {
          locationId,
          numero,
          fecha,
          nombreCliente: dto.nombreCliente,
          tipo: dto.tipo,
          estado: 'PENDIENTE_PAGO',
          subtotal: armado.value.subtotal,
          total: armado.value.total,
          // El QR se congela en el pedido para que el cuadre separe totales por
          // cuenta si cambió de QR a media jornada (`PLAN §5b`).
          paymentQrId: qr?.id ?? null,
          intentoUuid: dto.intentoUuid,
          items: { create: armado.value.items.map((i) => ({ ...i })) },
        },
        include: { items: true },
      });

      return this.presentar(pedido, qr?.imagenUrl ?? null);
    });
  }

  // ---------------------------------------------------------------------------
  // RQ-307, RQ-308 — Consultar
  // ---------------------------------------------------------------------------

  /**
   * Estado de un pedido, para que el kiosco muestre "ya se confirmó tu pago".
   * Ruta pública: solo devuelve lo que el cliente ya sabe de su propio pedido.
   */
  async estadoPublico(id: string) {
    const pedido = await this.repo.porId(id);
    if (pedido === null) {
      throw new NotFoundException('Ese pedido no existe');
    }
    return {
      id: pedido.id,
      numero: pedido.numero,
      estado: pedido.estado,
      total: pedido.total,
      nombreCliente: pedido.nombreCliente,
    };
  }

  /**
   * RQ-308 — Cola de pedidos para el panel de cobro (`PLAN §5b`).
   *
   * Devuelve los pendientes de la jornada, más viejo primero: el que espera
   * hace rato es el que está por irse.
   */
  async pendientes(locationId: string) {
    const horaCorte = await this.repo.setting<number>(
      'hora_corte_jornada',
      HORA_CORTE_POR_DEFECTO,
    );
    const fecha = jornadaDe(new Date(), horaCorte);

    const pedidos = await this.prisma.order.findMany({
      where: { locationId, fecha, estado: 'PENDIENTE_PAGO' },
      include: { items: true },
      orderBy: { creadoEn: 'asc' },
    });

    return pedidos.map((p) => this.presentar(p));
  }

  /**
   * RQ-311 / R-01 — Buscar pedidos abiertos por monto.
   *
   * El panel de cobro busca por monto porque es el único dato que el extracto
   * bancario comparte con el pedido (`PLAN §5b`). Sin el sufijo de centavos
   * (D-04), dos pedidos pueden tener el mismo total.
   *
   * Por eso se devuelve una LISTA y una bandera `ambiguo`, nunca un solo
   * pedido: devolver "el primero" dejaría que quien confirma le acredite el
   * pago al cliente equivocado sin saber que había otro. La desambiguación es
   * obligatoria y la decide una persona mirando hora, nombre e ítems.
   */
  async buscarPorMonto(locationId: string, totalCentavos: number) {
    const coincidencias = await this.prisma.order.findMany({
      where: { locationId, estado: 'PENDIENTE_PAGO', total: totalCentavos },
      include: { items: true },
      orderBy: { creadoEn: 'asc' },
    });

    return {
      ambiguo: coincidencias.length > 1,
      cantidad: coincidencias.length,
      pedidos: coincidencias.map((p) => this.presentar(p)),
    };
  }

  // ---------------------------------------------------------------------------
  // RQ-306, RQ-309 — Cancelar
  // ---------------------------------------------------------------------------

  /**
   * RQ-306 — Cancela los pedidos que pasaron la ventana de pago.
   *
   * La ventana existe para que el panel de cobro no se llene de carritos
   * abandonados (`PLAN §5b`): con 40 pedidos muertos en pantalla, el que
   * importa se pierde.
   *
   * Se usa `updateMany` con el estado en el `WHERE`: si alguien confirmó el
   * pago en el instante entre leer y escribir, el update no afecta esa fila.
   * Un pedido pagado NO se cancela por timeout — eso sería perder plata ya
   * recibida.
   */
  async cancelarVencidos(locationId?: string) {
    const minutos = await this.repo.setting<number>(
      'minutos_expiracion_pedido',
      MINUTOS_EXPIRACION_POR_DEFECTO,
    );
    const limite = new Date(Date.now() - minutos * 60_000);
    const candidatos = await this.repo.pendientesVencidos(limite, locationId);

    const cancelados: number[] = [];
    for (const candidato of candidatos) {
      const r = await this.prisma.order.updateMany({
        where: { id: candidato.id, estado: 'PENDIENTE_PAGO' },
        data: {
          estado: 'CANCELADO',
          canceladoEn: new Date(),
          canceladoMotivo: `Sin pago tras ${minutos} minutos`,
        },
      });
      if (r.count === 1) {
        cancelados.push(candidato.numero);
      }
    }

    return { cancelados: cancelados.length, numeros: cancelados };
  }

  /**
   * RQ-309 — Cancelación manual.
   *
   * Solo ADMIN, y solo si el pedido NO está pagado. Cancelar un pedido pagado
   * es una devolución, no una cancelación: genera una obligación de plata
   * (D-09) y el flujo vive en B8. Dejarlo acá permitiría cerrar un pedido
   * cobrado sin dejar rastro de la deuda con el cliente.
   */
  async cancelar(id: string, usuarioId: string, motivo: string) {
    const pedido = await this.repo.porId(id);
    if (pedido === null) {
      throw new NotFoundException('Ese pedido no existe');
    }

    if (pedido.estado === 'PAGADO' || pedido.pagadoEn !== null) {
      throw new ForbiddenException(
        'Ese pedido ya está pagado. Cancelarlo implica devolver la plata: usá el flujo de devolución.',
      );
    }

    // La máquina de estados de S1 es la autoridad sobre qué transición vale
    // (RQ-102). Preguntarle en vez de escribir otro `if` evita que la regla
    // viva en dos lugares y se contradigan.
    if (!puedeTransicionar(pedido.estado, 'CANCELADO')) {
      throw new BadRequestException(
        `Un pedido ${pedido.estado.toLowerCase()} ya no se puede cancelar`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const r = await tx.order.updateMany({
        where: { id, estado: pedido.estado },
        data: {
          estado: 'CANCELADO',
          canceladoEn: new Date(),
          canceladoPorId: usuarioId,
          canceladoMotivo: motivo,
        },
      });

      if (r.count !== 1) {
        throw new BadRequestException(
          'El pedido cambió de estado mientras lo cancelabas. Volvé a mirarlo.',
        );
      }

      // Auditoría DENTRO de la transacción (D-07). Si se escribiera después del
      // commit y el proceso muriera en esa ventana, quedaría un pedido
      // cancelado sin autor.
      await tx.auditLog.create({
        data: {
          userId: usuarioId,
          accion: 'PEDIDO_CANCELADO',
          orderId: id,
          montoEsperado: pedido.total,
          detalle: { motivo, estadoAnterior: pedido.estado },
        },
      });

      return { id, numero: pedido.numero, estado: 'CANCELADO' as EstadoPedido };
    });
  }

  /**
   * RQ-310 / D-12 — Repetir un pedido vencido.
   *
   * La dueña pidió que un pago tardío no se pierda. `CANCELADO` es terminal en
   * la máquina de estados (RQ-102) y así se queda: reabrirlo permitiría
   * "revivir" un pedido viejo y atarle el pago de otro cliente.
   *
   * En su lugar se CREA UN PEDIDO NUEVO con los mismos ítems, número nuevo y
   * `intentoUuid` nuevo. El cliente no nota la diferencia y la auditoría queda
   * con dos pedidos trazables en vez de uno con historia borrada.
   *
   * Los precios se vuelven a leer del catálogo a propósito: si el precio
   * cambió, el pedido nuevo es un pedido de hoy, no una copia del de ayer.
   */
  async repetir(idOriginal: string, intentoUuid: string) {
    const original = await this.repo.porId(idOriginal);
    if (original === null) {
      throw new NotFoundException('Ese pedido no existe');
    }
    if (original.items.length === 0) {
      throw new BadRequestException('Ese pedido no tiene ítems para repetir');
    }

    return this.crear({
      items: original.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        cantidad: i.cantidad,
        notas: i.notas,
      })),
      // D-13: el nombre es obligatorio. Si el pedido viejo no lo tenía (datos
      // previos a la decisión), se usa un marcador antes que fallar.
      nombreCliente: original.nombreCliente ?? 'Sin nombre',
      tipo: original.tipo,
      intentoUuid,
    });
  }

  // ---------------------------------------------------------------------------
  // Presentación
  // ---------------------------------------------------------------------------

  /**
   * Forma de salida del pedido.
   *
   * Los montos salen en CENTAVOS. El formateo a "Bs 45" es del cliente, con
   * `Money` de `shared` (`ARQUITECTURA §6`): si la API mandara el texto ya
   * armado, cambiar el formato obligaría a tocar el servidor.
   */
  private presentar(
    pedido: {
      id: string;
      numero: number;
      estado: EstadoPedido;
      tipo: string;
      nombreCliente: string | null;
      subtotal: number;
      total: number;
      creadoEn: Date;
      items: {
        id: string;
        cantidad: number;
        notas: string | null;
        nombreSnapshot: string;
        precioUnitarioSnapshot: number;
      }[];
    },
    qrImagenUrl: string | null = null,
    _ip?: string,
  ) {
    return {
      id: pedido.id,
      numero: pedido.numero,
      estado: pedido.estado,
      tipo: pedido.tipo,
      nombreCliente: pedido.nombreCliente,
      subtotal: pedido.subtotal,
      total: pedido.total,
      creadoEn: pedido.creadoEn,
      qrImagenUrl,
      items: pedido.items.map((i) => ({
        id: i.id,
        nombre: i.nombreSnapshot,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitarioSnapshot,
        subtotal: i.precioUnitarioSnapshot * i.cantidad,
        notas: i.notas,
      })),
    };
  }
}

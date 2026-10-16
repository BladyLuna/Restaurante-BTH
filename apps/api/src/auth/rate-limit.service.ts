/**
 * RQ-113 — Límite de intentos de login
 *
 * Fuente: D-06, PLAN §6, REPORTE H13.
 *
 * Adelantado de O3 (sprint final) a B3 deliberadamente. Razón: un PIN de 6
 * dígitos son un millón de combinaciones, pero sin límite de intentos un
 * script las prueba igual. Dejarlo para el final significaba operar con dinero
 * real sin la mitad de la protección del PIN.
 *
 * Qué cuenta como "origen": la IP. En la LAN del local eso identifica al
 * dispositivo, que es la granularidad útil — bloquear por usuario permitiría
 * que un atacante bloquee a la cajera a propósito tipeando mal su PIN
 * (denegación de servicio contra el cobro).
 */

import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service.js';

export type ResultadoLimite =
  | { permitido: true; intentosRestantes: number }
  | { permitido: false; bloqueadoHasta: Date; minutosRestantes: number };

@Injectable()
export class RateLimitService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /** Valores por defecto si la configuración no está sembrada. */
  private static readonly MAX_INTENTOS_DEFAULT = 5;
  private static readonly BLOQUEO_MINUTOS_DEFAULT = 15;

  private async leerConfig(
    clave: string,
    porDefecto: number,
  ): Promise<number> {
    const fila = await this.prisma.setting.findUnique({ where: { clave } });
    if (fila === null) return porDefecto;
    const valor = fila.valor;
    return typeof valor === 'number' ? valor : porDefecto;
  }

  /**
   * ¿Este origen puede intentar? No registra nada: solo consulta.
   * La ventana es deslizante: cuenta los fallos de los últimos N minutos.
   */
  async verificar(origen: string): Promise<ResultadoLimite> {
    const maxIntentos = await this.leerConfig(
      'login.max_intentos',
      RateLimitService.MAX_INTENTOS_DEFAULT,
    );
    const bloqueoMinutos = await this.leerConfig(
      'login.bloqueo_minutos',
      RateLimitService.BLOQUEO_MINUTOS_DEFAULT,
    );

    const desde = new Date(Date.now() - bloqueoMinutos * 60_000);

    const fallidos = await this.prisma.loginAttempt.count({
      where: { origen, exitoso: false, creadoEn: { gte: desde } },
    });

    if (fallidos < maxIntentos) {
      return { permitido: true, intentosRestantes: maxIntentos - fallidos };
    }

    // Bloqueado: el desbloqueo se cuenta desde el fallo más antiguo de la
    // ventana, no desde el último. Así el bloqueo no se extiende para siempre
    // mientras alguien sigue probando.
    const masAntiguo = await this.prisma.loginAttempt.findFirst({
      where: { origen, exitoso: false, creadoEn: { gte: desde } },
      orderBy: { creadoEn: 'asc' },
    });

    const base = masAntiguo?.creadoEn ?? new Date();
    const bloqueadoHasta = new Date(base.getTime() + bloqueoMinutos * 60_000);
    const minutosRestantes = Math.max(
      1,
      Math.ceil((bloqueadoHasta.getTime() - Date.now()) / 60_000),
    );

    return { permitido: false, bloqueadoHasta, minutosRestantes };
  }

  async registrarFallo(origen: string): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: { origen, exitoso: false },
    });
  }

  /**
   * Un login exitoso limpia los fallos del origen. Si la cajera se equivocó
   * tres veces y después entró bien, no arrastra ese historial.
   */
  async registrarExito(origen: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.loginAttempt.create({ data: { origen, exitoso: true } }),
      this.prisma.loginAttempt.deleteMany({
        where: { origen, exitoso: false },
      }),
    ]);
  }

  /** Mantenimiento: borra intentos viejos para que la tabla no crezca sin fin. */
  async purgarViejos(diasRetencion = 30): Promise<number> {
    const limite = new Date(Date.now() - diasRetencion * 86_400_000);
    const r = await this.prisma.loginAttempt.deleteMany({
      where: { creadoEn: { lt: limite } },
    });
    return r.count;
  }
}

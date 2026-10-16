/**
 * RQ-110 a RQ-114 — Autenticación
 *
 * Fuente: PLAN §6, PLAN §5g, D-06, REPORTE C-05.
 *
 * La decisión que gobierna este archivo: REVOCACIÓN CON EFECTO INMEDIATO.
 *
 * El requisito de la dueña es poder quitarle el permiso a una cajera. Si el
 * sistema solo mirara el JWT, un token emitido antes de la revocación seguiría
 * sirviendo hasta vencer — y el navegador de la cajera lo tiene guardado. Una
 * revocación que tarda cuatro horas no es una revocación.
 *
 * Por eso cada request verifica el estado del usuario contra la base. Cuesta
 * una consulta por request; en una LAN con tres dispositivos eso no se nota, y
 * es lo que hace que "quitar el permiso" signifique algo.
 */

import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Rol, User } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from './rate-limit.service.js';
import {
  verificarPin,
  hashPin,
  validarFormaPin,
  largoMinimoParaRol,
  PinInvalidoError,
} from './pin.js';

export type PayloadToken = {
  sub: string;
  rol: Rol;
  locationId: string;
  nombre: string;
};

export type UsuarioAutenticado = {
  id: string;
  nombre: string;
  rol: Rol;
  locationId: string;
};

export type ResultadoLogin = {
  token: string;
  usuario: UsuarioAutenticado;
};

@Injectable()
export class AuthService {
  // @Inject explícito: tsx/esbuild no emite emitDecoratorMetadata.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * RQ-110 — Login por PIN.
   *
   * Dos cuidados:
   *   1. El mensaje de error nunca distingue "ese PIN no existe" de "ese PIN es
   *      de otro". Decir cuál falló le regala información al que prueba.
   *   2. Se verifica el PIN contra TODOS los usuarios activos del local. No hay
   *      campo de usuario: la persona solo tipea números (PLAN §7).
   */
  async login(pin: string, origen: string): Promise<ResultadoLogin> {
    const limite = await this.rateLimit.verificar(origen);
    if (!limite.permitido) {
      await this.auditarBloqueo(origen);
      throw new UnauthorizedException(
        `Demasiados intentos fallidos. Esperá ${limite.minutosRestantes} minutos.`,
      );
    }

    if (!/^\d{4,12}$/.test(pin)) {
      await this.rateLimit.registrarFallo(origen);
      throw new UnauthorizedException('PIN incorrecto');
    }

    const candidatos = await this.prisma.user.findMany({
      where: { activo: true },
    });

    const coincidencias: User[] = [];
    for (const u of candidatos) {
      if (await verificarPin(pin, u.pinHash)) {
        coincidencias.push(u);
      }
    }

    // Colisión de PIN: dos personas con el mismo PIN. No se puede saber quién
    // está entrando, y toda la auditoría se apoya en esa atribución (D-06).
    // Antes esto entraba al primero que encontraba, en silencio.
    if (coincidencias.length > 1) {
      await this.prisma.auditLog.create({
        data: {
          accion: 'LOGIN_FALLIDO',
          ip: origen,
          detalle: {
            motivo: 'colision_de_pin',
            usuariosAfectados: coincidencias.map((u) => u.id),
          },
        },
      });
      throw new UnauthorizedException(
        'Ese PIN está asignado a más de una persona. ' +
          'Avisá a la dueña para que lo cambie antes de seguir.',
      );
    }

    const encontrado: User | null = coincidencias[0] ?? null;

    if (encontrado === null) {
      await this.rateLimit.registrarFallo(origen);
      await this.prisma.auditLog.create({
        data: { accion: 'LOGIN_FALLIDO', ip: origen },
      });
      throw new UnauthorizedException('PIN incorrecto');
    }

    // Un PIN de 4 dígitos en un rol financiero es un dato viejo: el usuario
    // existe pero su PIN no cumple D-06. Se deja entrar, pero queda registrado.
    await this.rateLimit.registrarExito(origen);

    const payload: PayloadToken = {
      sub: encontrado.id,
      rol: encontrado.rol,
      locationId: encontrado.locationId,
      nombre: encontrado.nombre,
    };

    // RQ-111 — Sesiones de distinta duración.
    // Cocina dura la jornada: nadie quiere re-loguear con las manos sucias.
    // Quien confirma dinero, menos: un dispositivo olvidado abierto es el
    // riesgo real en un local (PLAN §6).
    const expiresIn =
      encontrado.rol === 'COCINA'
        ? (process.env['JWT_EXPIRES_COCINA'] ?? '12h')
        : (process.env['JWT_EXPIRES_ADMIN'] ?? '4h');

    const token = await this.jwt.signAsync(payload, { expiresIn });

    return {
      token,
      usuario: {
        id: encontrado.id,
        nombre: encontrado.nombre,
        rol: encontrado.rol,
        locationId: encontrado.locationId,
      },
    };
  }

  /**
   * RQ-114 — Verificación por request con revocación inmediata.
   *
   * El token puede ser válido y la sesión no servir: si el usuario fue
   * desactivado o le cambiaron el rol, el estado de la base manda sobre el
   * contenido del token.
   */
  async verificarToken(token: string): Promise<UsuarioAutenticado> {
    let payload: PayloadToken;
    try {
      payload = await this.jwt.verifyAsync<PayloadToken>(token);
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    const usuario = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (usuario === null || !usuario.activo) {
      throw new UnauthorizedException('Tu acceso fue desactivado');
    }

    // El rol del token puede estar viejo. Gana el de la base: si la dueña le
    // quitó CAJA a alguien, el token con rol CAJA no debe servir.
    if (usuario.rol !== payload.rol) {
      throw new UnauthorizedException(
        'Tus permisos cambiaron, volvé a iniciar sesión',
      );
    }

    return {
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      locationId: usuario.locationId,
    };
  }

  /**
   * Cambio de PIN propio. Exige el PIN actual: si alguien dejó la sesión
   * abierta, no debe poder quedarse con la cuenta.
   */
  async cambiarPinPropio(
    userId: string,
    pinActual: string,
    pinNuevo: string,
  ): Promise<void> {
    const usuario = await this.prisma.user.findUnique({ where: { id: userId } });
    if (usuario === null || !usuario.activo) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    if (!(await verificarPin(pinActual, usuario.pinHash))) {
      throw new UnauthorizedException('El PIN actual no es correcto');
    }

    try {
      validarFormaPin(pinNuevo, largoMinimoParaRol(usuario.rol));
    } catch (e) {
      if (e instanceof PinInvalidoError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    if (await verificarPin(pinNuevo, usuario.pinHash)) {
      throw new BadRequestException('El PIN nuevo es igual al actual');
    }

    const hash = await hashPin(pinNuevo);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { pinHash: hash },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          targetUserId: userId,
          accion: 'PIN_RESETEADO',
          detalle: { propio: true },
        },
      }),
    ]);
  }

  /** Datos del usuario de la sesión actual. */
  async yo(userId: string): Promise<UsuarioAutenticado> {
    const usuario = await this.prisma.user.findUnique({ where: { id: userId } });
    if (usuario === null || !usuario.activo) {
      throw new ForbiddenException('Tu acceso fue desactivado');
    }
    return {
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      locationId: usuario.locationId,
    };
  }

  private async auditarBloqueo(origen: string): Promise<void> {
    // Una sola fila por ventana de bloqueo: si no, un script genera miles.
    const hace5min = new Date(Date.now() - 5 * 60_000);
    const yaRegistrado = await this.prisma.auditLog.findFirst({
      where: {
        accion: 'LOGIN_BLOQUEADO',
        ip: origen,
        creadoEn: { gte: hace5min },
      },
    });
    if (yaRegistrado === null) {
      await this.prisma.auditLog.create({
        data: { accion: 'LOGIN_BLOQUEADO', ip: origen },
      });
    }
  }
}

/**
 * Tests de integración de auth — RQ-110 a RQ-114.
 *
 * El test que más importa acá es el de revocación inmediata: es el requisito
 * de la dueña ("quitar el permiso a la cajera") y la razón por la que cada
 * request consulta la base en lugar de confiar solo en el JWT.
 *
 * Requiere la base levantada: docker compose up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { hashPin } from './pin.js';
import type { PrismaService } from '../infra/prisma.service.js';

const prisma = new PrismaClient();
const LOC = 'test-auth-loc';

const jwt = new JwtService({ secret: 'secreto-de-prueba' });
const rateLimit = new RateLimitService(prisma as unknown as PrismaService);
const auth = new AuthService(
  prisma as unknown as PrismaService,
  jwt,
  rateLimit,
);

// PIN exclusivos de los tests. No deben coincidir con los del seed: dos
// usuarios con el mismo PIN es una colisión que el login rechaza a propósito.
const PIN_ADMIN = '635281';
const PIN_CAJA = '917403';
const PIN_COCINA = '8426';

let idAdmin = '';
let idCaja = '';
let idCocina = '';

async function limpiar(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE "userId" IN (SELECT id FROM users WHERE "locationId" = ${LOC}) OR "targetUserId" IN (SELECT id FROM users WHERE "locationId" = ${LOC}) OR ip LIKE 'test-%'`;
  await prisma.$executeRaw`DELETE FROM login_attempts WHERE origen LIKE 'test-%'`;
  await prisma.$executeRaw`DELETE FROM users WHERE "locationId" = ${LOC}`;
  await prisma.$executeRaw`DELETE FROM locations WHERE id = ${LOC}`;
}

beforeAll(async () => {
  await limpiar();
  await prisma.location.create({
    data: { id: LOC, nombre: 'Local de prueba auth', activo: true },
  });

  const admin = await prisma.user.create({
    data: {
      locationId: LOC,
      nombre: 'Dueña de prueba',
      rol: 'ADMIN',
      pinHash: await hashPin(PIN_ADMIN),
      activo: true,
    },
  });
  idAdmin = admin.id;

  const caja = await prisma.user.create({
    data: {
      locationId: LOC,
      nombre: 'Cajera de prueba',
      rol: 'CAJA',
      pinHash: await hashPin(PIN_CAJA),
      activo: true,
    },
  });
  idCaja = caja.id;

  const cocina = await prisma.user.create({
    data: {
      locationId: LOC,
      nombre: 'Cocina de prueba',
      rol: 'COCINA',
      pinHash: await hashPin(PIN_COCINA),
      activo: true,
    },
  });
  idCocina = cocina.id;
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM login_attempts WHERE origen LIKE 'test-%'`;
  // Reactivar por si un test anterior desactivó a alguien.
  await prisma.user.updateMany({
    where: { locationId: LOC },
    data: { activo: true },
  });
  await prisma.user.update({ where: { id: idCaja }, data: { rol: 'CAJA' } });
});

describe('RQ-110 — login por PIN', () => {
  it('entra con el PIN correcto y devuelve el rol', async () => {
    const r = await auth.login(PIN_CAJA, 'test-ip-1');
    expect(r.usuario.rol).toBe('CAJA');
    expect(r.usuario.nombre).toBe('Cajera de prueba');
    expect(r.token.length).toBeGreaterThan(20);
  });

  it('cada PIN entra a su propio usuario', async () => {
    const a = await auth.login(PIN_ADMIN, 'test-ip-2');
    const b = await auth.login(PIN_COCINA, 'test-ip-3');
    expect(a.usuario.rol).toBe('ADMIN');
    expect(b.usuario.rol).toBe('COCINA');
    expect(a.usuario.id).not.toBe(b.usuario.id);
  });

  it('rechaza un PIN que no existe', async () => {
    await expect(auth.login('999999', 'test-ip-4')).rejects.toThrow();
  });

  it('el mensaje de error no revela si el PIN existe', async () => {
    try {
      await auth.login('999999', 'test-ip-5');
      expect.unreachable('debía fallar');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toBe('PIN incorrecto');
      expect(msg).not.toContain('usuario');
      expect(msg).not.toContain('no existe');
    }
  });

  it('rechaza un PIN con letras sin consultar la base', async () => {
    await expect(auth.login('abc123', 'test-ip-6')).rejects.toThrow();
  });

  it('registra el intento fallido en auditoría', async () => {
    await expect(auth.login('999998', 'test-ip-audit')).rejects.toThrow();
    const filas = await prisma.auditLog.findMany({
      where: { accion: 'LOGIN_FALLIDO', ip: 'test-ip-audit' },
    });
    expect(filas.length).toBeGreaterThan(0);
  });

  it('un usuario desactivado no puede entrar', async () => {
    await prisma.user.update({
      where: { id: idCaja },
      data: { activo: false },
    });
    await expect(auth.login(PIN_CAJA, 'test-ip-7')).rejects.toThrow();
  });
});

describe('RQ-111 — duración de sesión por rol', () => {
  it('el token de cocina dura más que el de quien cobra', async () => {
    const cocina = await auth.login(PIN_COCINA, 'test-ip-dur-1');
    const admin = await auth.login(PIN_ADMIN, 'test-ip-dur-2');

    const expCocina = jwt.decode<{ exp: number }>(cocina.token).exp;
    const expAdmin = jwt.decode<{ exp: number }>(admin.token).exp;

    expect(expCocina).toBeGreaterThan(expAdmin);
  });
});

describe('RQ-113 — límite de intentos', () => {
  it('bloquea después de 5 fallos desde el mismo origen', async () => {
    const origen = 'test-ip-bloqueo';
    for (let i = 0; i < 5; i++) {
      await expect(auth.login('999997', origen)).rejects.toThrow();
    }

    // El sexto debe decir que está bloqueado, no "PIN incorrecto".
    try {
      await auth.login(PIN_CAJA, origen);
      expect.unreachable('debía estar bloqueado');
    } catch (e) {
      expect((e as Error).message).toContain('Demasiados intentos');
    }
  });

  it('el bloqueo es por origen, no global: otro dispositivo sigue entrando', async () => {
    const origen = 'test-ip-aislado';
    for (let i = 0; i < 5; i++) {
      await expect(auth.login('999996', origen)).rejects.toThrow();
    }

    const otro = await auth.login(PIN_CAJA, 'test-ip-otro-dispositivo');
    expect(otro.usuario.rol).toBe('CAJA');
  });

  it('un login exitoso limpia los fallos anteriores', async () => {
    const origen = 'test-ip-limpieza';
    for (let i = 0; i < 3; i++) {
      await expect(auth.login('999995', origen)).rejects.toThrow();
    }

    await auth.login(PIN_CAJA, origen);

    const fallidos = await prisma.loginAttempt.count({
      where: { origen, exitoso: false },
    });
    expect(fallidos).toBe(0);
  });

  it('registra el bloqueo en auditoría', async () => {
    const origen = 'test-ip-audit-bloqueo';
    for (let i = 0; i < 6; i++) {
      await expect(auth.login('999994', origen)).rejects.toThrow();
    }
    const filas = await prisma.auditLog.findMany({
      where: { accion: 'LOGIN_BLOQUEADO', ip: origen },
    });
    expect(filas.length).toBeGreaterThan(0);
  });
});

describe('RQ-114 — revocación con efecto inmediato', () => {
  it('un token válido deja de servir si desactivan al usuario', async () => {
    const { token } = await auth.login(PIN_CAJA, 'test-ip-rev-1');

    // El token sirve ahora.
    const antes = await auth.verificarToken(token);
    expect(antes.rol).toBe('CAJA');

    // La dueña le quita el acceso.
    await prisma.user.update({
      where: { id: idCaja },
      data: { activo: false },
    });

    // El mismo token, sin haber vencido, ya no sirve.
    await expect(auth.verificarToken(token)).rejects.toThrow(
      /desactivado/,
    );
  });

  it('un token deja de servir si le cambian el rol', async () => {
    const { token } = await auth.login(PIN_CAJA, 'test-ip-rev-2');
    expect((await auth.verificarToken(token)).rol).toBe('CAJA');

    // La dueña le baja el rol a cocina.
    await prisma.user.update({
      where: { id: idCaja },
      data: { rol: 'COCINA' },
    });

    await expect(auth.verificarToken(token)).rejects.toThrow(
      /permisos cambiaron/,
    );
  });

  it('rechaza un token firmado con otra clave', async () => {
    const otroJwt = new JwtService({ secret: 'clave-del-atacante' });
    const falso = await otroJwt.signAsync({
      sub: idAdmin,
      rol: 'ADMIN',
      locationId: LOC,
      nombre: 'Falso',
    });
    await expect(auth.verificarToken(falso)).rejects.toThrow();
  });

  it('rechaza un token de un usuario que ya no existe', async () => {
    const huerfano = await jwt.signAsync({
      sub: 'usuario-inexistente',
      rol: 'ADMIN',
      locationId: LOC,
      nombre: 'Fantasma',
    });
    await expect(auth.verificarToken(huerfano)).rejects.toThrow();
  });

  it('rechaza basura y vacío', async () => {
    await expect(auth.verificarToken('no-es-un-token')).rejects.toThrow();
    await expect(auth.verificarToken('')).rejects.toThrow();
  });
});

describe('cambio de PIN propio', () => {
  it('cambia el PIN con el actual correcto', async () => {
    await auth.cambiarPinPropio(idCocina, PIN_COCINA, '7391');
    const r = await auth.login('7391', 'test-ip-cambio-1');
    expect(r.usuario.rol).toBe('COCINA');

    // Volver al original para no romper otros tests.
    await auth.cambiarPinPropio(idCocina, '7391', PIN_COCINA);
  });

  it('rechaza si el PIN actual es incorrecto', async () => {
    await expect(
      auth.cambiarPinPropio(idCocina, '0000', '7391'),
    ).rejects.toThrow();
  });

  it('exige 6 dígitos para un rol financiero', async () => {
    await expect(
      auth.cambiarPinPropio(idAdmin, PIN_ADMIN, '7391'),
    ).rejects.toThrow(/6 dígitos/);
  });

  it('rechaza un PIN nuevo igual al actual', async () => {
    await expect(
      auth.cambiarPinPropio(idAdmin, PIN_ADMIN, PIN_ADMIN),
    ).rejects.toThrow(/igual al actual/);
  });

  it('rechaza secuencias como PIN nuevo', async () => {
    await expect(
      auth.cambiarPinPropio(idAdmin, PIN_ADMIN, '123456'),
    ).rejects.toThrow();
  });

  it('deja el cambio en auditoría', async () => {
    await auth.cambiarPinPropio(idCocina, PIN_COCINA, '7391');
    const filas = await prisma.auditLog.findMany({
      where: { accion: 'PIN_RESETEADO', targetUserId: idCocina },
    });
    expect(filas.length).toBeGreaterThan(0);
    await auth.cambiarPinPropio(idCocina, '7391', PIN_COCINA);
  });
});

describe('colisión de PIN — dos personas con el mismo PIN', () => {
  it('rechaza el login en vez de entrar al primero que encuentra', async () => {
    // Le ponemos a cocina el mismo PIN que tiene la cajera.
    await prisma.user.update({
      where: { id: idCocina },
      data: { pinHash: await hashPin(PIN_CAJA) },
    });

    try {
      await auth.login(PIN_CAJA, 'test-ip-colision');
      expect.unreachable('debía rechazar la colisión');
    } catch (e) {
      expect((e as Error).message).toContain('más de una persona');
    }

    // Restaurar.
    await prisma.user.update({
      where: { id: idCocina },
      data: { pinHash: await hashPin(PIN_COCINA) },
    });
  });

  it('registra la colisión en auditoría con los usuarios afectados', async () => {
    await prisma.user.update({
      where: { id: idCocina },
      data: { pinHash: await hashPin(PIN_CAJA) },
    });

    await expect(
      auth.login(PIN_CAJA, 'test-ip-colision-audit'),
    ).rejects.toThrow();

    const fila = await prisma.auditLog.findFirst({
      where: { accion: 'LOGIN_FALLIDO', ip: 'test-ip-colision-audit' },
    });
    expect(fila).not.toBeNull();
    const detalle = fila?.detalle as { motivo?: string } | null;
    expect(detalle?.motivo).toBe('colision_de_pin');

    await prisma.user.update({
      where: { id: idCocina },
      data: { pinHash: await hashPin(PIN_COCINA) },
    });
  });
});

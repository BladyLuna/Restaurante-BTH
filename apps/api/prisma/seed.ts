/**
 * RQ-108 — Seed de desarrollo
 *
 * Fuente: PLAN §9 fase 0, S1 RQ-108.
 *
 * Carga un local, los tres usuarios con sus roles, un QR de cobro y un menú
 * chico pero realista de Cochabamba.
 *
 * Dos cosas deliberadas:
 *   - Cada usuario tiene SU PROPIO PIN. Nunca uno compartido: sin eso el
 *     AuditLog no puede atribuir una confirmación a nadie (D-06).
 *   - Los PIN de desarrollo se imprimen en pantalla al final. Son de
 *     desarrollo; en el local real se asignan desde el panel.
 *
 * Idempotente: se puede correr dos veces sin duplicar nada.
 */

import { PrismaClient, Rol } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/**
 * Parámetros de argon2id. Fuente: S1 RQ-112.
 * 64 MB y 3 iteraciones: un PIN de 6 dígitos son un millón de combinaciones,
 * barato de recorrer si el hash es rápido. Esto lo encarece lo suficiente sin
 * que el login se note lento.
 */
const ARGON2_OPCIONES = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

/** Bs → centavos. Solo enteros (D-04). */
function bs(bolivianos: number): number {
  if (!Number.isInteger(bolivianos)) {
    throw new Error(
      `El seed intentó sembrar Bs ${bolivianos}. Los precios son enteros (D-04).`,
    );
  }
  return bolivianos * 100;
}

type UsuarioSeed = {
  nombre: string;
  rol: Rol;
  pin: string;
};

const USUARIOS: readonly UsuarioSeed[] = [
  // 6 dígitos para quien confirma pagos (D-06).
  { nombre: 'Dueña', rol: Rol.ADMIN, pin: '739204' },
  { nombre: 'Cajera', rol: Rol.CAJA, pin: '482917' },
  // 4 dígitos admisibles para cocina: no autoriza dinero.
  { nombre: 'Cocina', rol: Rol.COCINA, pin: '1573' },
];

const MENU = [
  {
    categoria: 'Almuerzos',
    platos: [
      { nombre: 'Pique macho', descripcion: 'Para compartir', precio: bs(45) },
      { nombre: 'Silpancho', descripcion: 'Con huevo y arroz', precio: bs(30) },
      { nombre: 'Milanesa de pollo', descripcion: null, precio: bs(28) },
      { nombre: 'Trucha frita', descripcion: 'Con papa y ensalada', precio: bs(40) },
    ],
  },
  {
    categoria: 'Sopas',
    platos: [
      { nombre: 'Chairo', descripcion: null, precio: bs(18) },
      { nombre: 'Sopa de maní', descripcion: null, precio: bs(18) },
    ],
  },
  {
    categoria: 'Bebidas',
    platos: [
      // Con variantes: el kiosco muestra los tamaños.
      {
        nombre: 'Refresco',
        descripcion: null,
        precio: bs(5),
        variantes: [
          { nombre: 'Vaso', precio: bs(5) },
          { nombre: 'Jarra', precio: bs(15) },
        ],
      },
      {
        nombre: 'Agua',
        descripcion: null,
        precio: bs(5),
        variantes: [
          { nombre: '500 ml', precio: bs(5) },
          { nombre: '2 litros', precio: bs(10) },
        ],
      },
      { nombre: 'Café', descripcion: null, precio: bs(8) },
    ],
  },
  {
    categoria: 'Postres',
    platos: [
      { nombre: 'Flan', descripcion: null, precio: bs(10) },
      { nombre: 'Helado', descripcion: 'Dos bochas', precio: bs(12) },
    ],
  },
] as const;

/** Configuración inicial. Fuente: ARQUITECTURA §1 — en tabla, no en .env. */
const CONFIGURACION = [
  {
    clave: 'pedido.timeout_minutos',
    valor: 15,
    nota: 'Minutos antes de vencer un pedido impago (PLAN §5b)',
  },
  {
    clave: 'jornada.hora_corte',
    valor: 5,
    nota: 'Hora de corte de la jornada. PENDIENTE de confirmación de la dueña (PLAN §5e regla 5)',
  },
  {
    clave: 'kiosco.auto_reset_segundos',
    valor: 60,
    nota: 'Segundos de inactividad antes de limpiar el carrito (PLAN §7)',
  },
  {
    clave: 'login.max_intentos',
    valor: 5,
    nota: 'Intentos fallidos antes de bloquear (D-06)',
  },
  {
    clave: 'login.bloqueo_minutos',
    valor: 15,
    nota: 'Minutos de bloqueo tras agotar los intentos (D-06)',
  },
] as const;

async function main(): Promise<void> {
  console.log('Sembrando datos de desarrollo...\n');

  // --- Local -------------------------------------------------------------
  const location = await prisma.location.upsert({
    where: { id: 'local-principal' },
    update: {},
    create: { id: 'local-principal', nombre: 'Local principal', activo: true },
  });
  console.log(`Local: ${location.nombre}`);

  // --- Usuarios ----------------------------------------------------------
  // Un PIN por persona. El hash es lo único que se guarda.
  for (const u of USUARIOS) {
    const pinHash = await argon2.hash(u.pin, ARGON2_OPCIONES);
    const existente = await prisma.user.findFirst({
      where: { locationId: location.id, nombre: u.nombre },
    });

    if (existente) {
      await prisma.user.update({
        where: { id: existente.id },
        data: { pinHash, rol: u.rol, activo: true },
      });
    } else {
      await prisma.user.create({
        data: {
          locationId: location.id,
          nombre: u.nombre,
          rol: u.rol,
          pinHash,
          activo: true,
        },
      });
    }
    console.log(`Usuario: ${u.nombre} (${u.rol})`);
  }

  // --- QR de cobro -------------------------------------------------------
  // Uno solo activo (PLAN §5b). La imagen es un placeholder: la real la sube
  // la dueña desde el panel.
  const qrExistente = await prisma.paymentQr.findFirst({
    where: { locationId: location.id },
  });
  if (!qrExistente) {
    await prisma.paymentQr.create({
      data: {
        locationId: location.id,
        etiqueta: 'QR de desarrollo',
        imagenUrl: '/uploads/qr-placeholder.png',
        activo: true,
        archivado: false,
      },
    });
    console.log('QR de cobro: 1 activo');
  } else {
    console.log('QR de cobro: ya existía');
  }

  // --- Menú --------------------------------------------------------------
  let ordenCategoria = 0;
  let totalPlatos = 0;

  for (const grupo of MENU) {
    let categoria = await prisma.category.findFirst({
      where: { nombre: grupo.categoria },
    });

    if (!categoria) {
      categoria = await prisma.category.create({
        data: { nombre: grupo.categoria, orden: ordenCategoria, activo: true },
      });
    }

    let ordenPlato = 0;
    for (const plato of grupo.platos) {
      const variantes = 'variantes' in plato ? plato.variantes : undefined;

      const existente = await prisma.product.findFirst({
        where: { categoryId: categoria.id, nombre: plato.nombre },
      });

      if (!existente) {
        const creado = await prisma.product.create({
          data: {
            categoryId: categoria.id,
            nombre: plato.nombre,
            descripcion: plato.descripcion,
            precioBase: plato.precio,
            activo: true,
            orden: ordenPlato,
            tieneVariantes: variantes !== undefined,
          },
        });

        if (variantes !== undefined) {
          let ordenVariante = 0;
          for (const v of variantes) {
            await prisma.productVariant.create({
              data: {
                productId: creado.id,
                nombre: v.nombre,
                precio: v.precio,
                activo: true,
                orden: ordenVariante,
              },
            });
            ordenVariante++;
          }
        }
        totalPlatos++;
      }
      ordenPlato++;
    }
    ordenCategoria++;
  }
  console.log(`Menú: ${MENU.length} categorías, ${totalPlatos} platos nuevos`);

  // --- Configuración -----------------------------------------------------
  for (const c of CONFIGURACION) {
    await prisma.setting.upsert({
      where: { clave: c.clave },
      update: {},
      create: { clave: c.clave, valor: c.valor },
    });
  }
  console.log(`Configuración: ${CONFIGURACION.length} claves\n`);

  console.log('PIN de desarrollo (solo desarrollo, no usar en el local):');
  for (const u of USUARIOS) {
    console.log(`  ${u.nombre.padEnd(8)} ${u.rol.padEnd(7)} ${u.pin}`);
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error('El seed falló:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

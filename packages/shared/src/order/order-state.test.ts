/**
 * Tests de la máquina de estados — RQ-102.
 *
 * Fuente del plan de pruebas: ARQUITECTURA §8 ("toda transición inválida debe
 * ser rechazada") y S1 RQ-102.
 *
 * El test que más vale: la enumeración exhaustiva. Recorre las 36 combinaciones
 * posibles y verifica que solo las 6 de la tabla sean válidas. Así, si alguien
 * agrega un estado y se olvida de la tabla, el test falla.
 */

import { describe, it, expect } from 'vitest';
import {
  ESTADOS,
  TRANSICIONES,
  ROLES,
  puedeTransicionar,
  actorPuedeTransicionar,
  esTerminal,
  transicionesDesde,
  ESTADOS_COCINA,
  esTrabajoDeCocina,
  esperaConfirmacionDePago,
  tuvoPagoConfirmado,
  describirError,
  type EstadoPedido,
} from './order-state.js';

describe('la tabla de transiciones', () => {
  it('cubre los seis estados', () => {
    expect(ESTADOS).toHaveLength(6);
    for (const e of ESTADOS) {
      expect(TRANSICIONES[e]).toBeDefined();
    }
  });

  it('permite exactamente las transiciones del flujo documentado', () => {
    expect(puedeTransicionar('PENDIENTE_PAGO', 'PAGADO')).toBe(true);
    expect(puedeTransicionar('PENDIENTE_PAGO', 'CANCELADO')).toBe(true);
    expect(puedeTransicionar('PAGADO', 'EN_PREPARACION')).toBe(true);
    expect(puedeTransicionar('PAGADO', 'CANCELADO')).toBe(true);
    expect(puedeTransicionar('EN_PREPARACION', 'LISTO')).toBe(true);
    expect(puedeTransicionar('LISTO', 'ENTREGADO')).toBe(true);
  });

  it('rechaza toda transición que no esté en la tabla — exhaustivo', () => {
    const validas = new Set<string>();
    for (const desde of ESTADOS) {
      for (const hacia of TRANSICIONES[desde]) {
        validas.add(`${desde}->${hacia}`);
      }
    }

    expect(validas.size).toBe(6);

    let rechazadas = 0;
    for (const desde of ESTADOS) {
      for (const hacia of ESTADOS) {
        const esperado = validas.has(`${desde}->${hacia}`);
        expect(puedeTransicionar(desde, hacia)).toBe(esperado);
        if (!esperado) rechazadas++;
      }
    }
    expect(rechazadas).toBe(30);
  });

  it('un pedido sin pago no puede saltar a preparación', () => {
    expect(puedeTransicionar('PENDIENTE_PAGO', 'EN_PREPARACION')).toBe(false);
    expect(puedeTransicionar('PENDIENTE_PAGO', 'LISTO')).toBe(false);
    expect(puedeTransicionar('PENDIENTE_PAGO', 'ENTREGADO')).toBe(false);
  });

  it('no se puede cancelar durante la preparación ni estando listo', () => {
    expect(puedeTransicionar('EN_PREPARACION', 'CANCELADO')).toBe(false);
    expect(puedeTransicionar('LISTO', 'CANCELADO')).toBe(false);
  });

  it('no se puede volver atrás', () => {
    expect(puedeTransicionar('PAGADO', 'PENDIENTE_PAGO')).toBe(false);
    expect(puedeTransicionar('LISTO', 'EN_PREPARACION')).toBe(false);
    expect(puedeTransicionar('ENTREGADO', 'LISTO')).toBe(false);
  });

  it('ningún estado transiciona a sí mismo', () => {
    for (const e of ESTADOS) {
      expect(puedeTransicionar(e, e)).toBe(false);
    }
  });
});

describe('estados terminales', () => {
  it('ENTREGADO y CANCELADO no tienen salida', () => {
    expect(esTerminal('ENTREGADO')).toBe(true);
    expect(esTerminal('CANCELADO')).toBe(true);
    expect(transicionesDesde('ENTREGADO')).toHaveLength(0);
    expect(transicionesDesde('CANCELADO')).toHaveLength(0);
  });

  it('los demás sí', () => {
    const noTerminales: EstadoPedido[] = [
      'PENDIENTE_PAGO',
      'PAGADO',
      'EN_PREPARACION',
      'LISTO',
    ];
    for (const e of noTerminales) {
      expect(esTerminal(e)).toBe(false);
    }
  });

  it('no hay reembolso ni reapertura como transición', () => {
    for (const hacia of ESTADOS) {
      expect(puedeTransicionar('CANCELADO', hacia)).toBe(false);
      expect(puedeTransicionar('ENTREGADO', hacia)).toBe(false);
    }
  });
});

describe('permisos por actor — PLAN §5g', () => {
  it('CAJA y ADMIN confirman pagos', () => {
    expect(actorPuedeTransicionar('PENDIENTE_PAGO', 'PAGADO', 'CAJA')).toBe(true);
    expect(actorPuedeTransicionar('PENDIENTE_PAGO', 'PAGADO', 'ADMIN')).toBe(true);
  });

  it('COCINA no confirma pagos', () => {
    expect(actorPuedeTransicionar('PENDIENTE_PAGO', 'PAGADO', 'COCINA')).toBe(
      false,
    );
  });

  it('el kiosco no confirma pagos', () => {
    expect(actorPuedeTransicionar('PENDIENTE_PAGO', 'PAGADO', 'KIOSCO')).toBe(
      false,
    );
  });

  it('CAJA no cancela un pedido pagado — D-02', () => {
    expect(actorPuedeTransicionar('PAGADO', 'CANCELADO', 'CAJA')).toBe(false);
    expect(actorPuedeTransicionar('PAGADO', 'CANCELADO', 'ADMIN')).toBe(true);
  });

  it('solo COCINA avanza la preparación', () => {
    expect(actorPuedeTransicionar('PAGADO', 'EN_PREPARACION', 'COCINA')).toBe(
      true,
    );
    expect(actorPuedeTransicionar('PAGADO', 'EN_PREPARACION', 'CAJA')).toBe(
      false,
    );
    expect(actorPuedeTransicionar('PAGADO', 'EN_PREPARACION', 'ADMIN')).toBe(
      false,
    );
  });

  it('COCINA, CAJA y ADMIN pueden marcar entregado', () => {
    expect(actorPuedeTransicionar('LISTO', 'ENTREGADO', 'COCINA')).toBe(true);
    expect(actorPuedeTransicionar('LISTO', 'ENTREGADO', 'CAJA')).toBe(true);
    expect(actorPuedeTransicionar('LISTO', 'ENTREGADO', 'ADMIN')).toBe(true);
  });

  it('el SISTEMA vence pedidos impagos, nadie más automáticamente', () => {
    expect(
      actorPuedeTransicionar('PENDIENTE_PAGO', 'CANCELADO', 'SISTEMA'),
    ).toBe(true);
    expect(actorPuedeTransicionar('PENDIENTE_PAGO', 'CANCELADO', 'COCINA')).toBe(
      false,
    );
  });

  it('una transición inválida sigue siendo inválida para cualquier rol', () => {
    for (const rol of ROLES) {
      expect(
        actorPuedeTransicionar('PENDIENTE_PAGO', 'EN_PREPARACION', rol),
      ).toBe(false);
      expect(actorPuedeTransicionar('ENTREGADO', 'LISTO', rol)).toBe(false);
    }
  });
});

describe('trabajo de cocina — PLAN §6, REPORTE COC-01', () => {
  it('el tablero incluye PAGADO, EN_PREPARACION y LISTO', () => {
    expect(ESTADOS_COCINA).toEqual(['PAGADO', 'EN_PREPARACION', 'LISTO']);
  });

  it('PENDIENTE_PAGO nunca es trabajo preparable', () => {
    expect(esTrabajoDeCocina('PENDIENTE_PAGO')).toBe(false);
  });

  it('ni los terminales', () => {
    expect(esTrabajoDeCocina('ENTREGADO')).toBe(false);
    expect(esTrabajoDeCocina('CANCELADO')).toBe(false);
  });
});

describe('predicados financieros', () => {
  it('esperaConfirmacionDePago', () => {
    expect(esperaConfirmacionDePago('PENDIENTE_PAGO')).toBe(true);
    expect(esperaConfirmacionDePago('PAGADO')).toBe(false);
  });

  it('tuvoPagoConfirmado cubre todo lo posterior al cobro', () => {
    expect(tuvoPagoConfirmado('PAGADO')).toBe(true);
    expect(tuvoPagoConfirmado('EN_PREPARACION')).toBe(true);
    expect(tuvoPagoConfirmado('LISTO')).toBe(true);
    expect(tuvoPagoConfirmado('ENTREGADO')).toBe(true);
  });

  it('un pedido impago o cancelado desde impago no cuenta como cobrado', () => {
    expect(tuvoPagoConfirmado('PENDIENTE_PAGO')).toBe(false);
    expect(tuvoPagoConfirmado('CANCELADO')).toBe(false);
  });
});

describe('mensajes de error', () => {
  it('describe una transición inválida', () => {
    const msg = describirError({
      tipo: 'transicion_invalida',
      desde: 'PENDIENTE_PAGO',
      hacia: 'LISTO',
    });
    expect(msg).toContain('PENDIENTE_PAGO');
    expect(msg).toContain('LISTO');
  });

  it('describe un actor no autorizado', () => {
    const msg = describirError({
      tipo: 'actor_no_autorizado',
      desde: 'PAGADO',
      hacia: 'CANCELADO',
      actor: 'CAJA',
    });
    expect(msg).toContain('CAJA');
  });
});

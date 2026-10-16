/**
 * Tests de PIN — RQ-112.
 * Unitarios, sin base de datos.
 */

import { describe, it, expect } from 'vitest';
import {
  hashPin,
  verificarPin,
  validarFormaPin,
  largoMinimoParaRol,
  LARGO_PIN,
  PinInvalidoError,
} from './pin.js';

describe('hash y verificación', () => {
  it('el hash no contiene el PIN', async () => {
    const hash = await hashPin('739204');
    expect(hash).not.toContain('739204');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('dos hashes del mismo PIN son distintos — salt aleatorio', async () => {
    const a = await hashPin('739204');
    const b = await hashPin('739204');
    expect(a).not.toBe(b);
  });

  it('verifica el PIN correcto', async () => {
    const hash = await hashPin('739204');
    expect(await verificarPin('739204', hash)).toBe(true);
  });

  it('rechaza el PIN incorrecto', async () => {
    const hash = await hashPin('739204');
    expect(await verificarPin('739205', hash)).toBe(false);
    expect(await verificarPin('', hash)).toBe(false);
  });

  it('un hash corrupto devuelve false en vez de lanzar', async () => {
    expect(await verificarPin('739204', 'esto-no-es-un-hash')).toBe(false);
    expect(await verificarPin('739204', '')).toBe(false);
  });
});

describe('forma del PIN', () => {
  it('acepta un PIN de 6 dígitos para rol financiero', () => {
    expect(() => validarFormaPin('739204', LARGO_PIN.FINANCIERO)).not.toThrow();
  });

  it('rechaza 4 dígitos cuando se exigen 6', () => {
    expect(() => validarFormaPin('1573', LARGO_PIN.FINANCIERO)).toThrow(
      PinInvalidoError,
    );
  });

  it('acepta 4 dígitos para rol operativo', () => {
    expect(() => validarFormaPin('1573', LARGO_PIN.OPERATIVO)).not.toThrow();
  });

  it('rechaza letras: la tablet se usa con las manos ocupadas', () => {
    expect(() => validarFormaPin('abc123', 4)).toThrow(PinInvalidoError);
    expect(() => validarFormaPin('73 204', 4)).toThrow(PinInvalidoError);
  });

  it('rechaza todos los dígitos iguales', () => {
    expect(() => validarFormaPin('1111', 4)).toThrow(PinInvalidoError);
    expect(() => validarFormaPin('000000', 6)).toThrow(PinInvalidoError);
  });

  it('rechaza secuencias: son lo primero que prueba cualquiera', () => {
    expect(() => validarFormaPin('1234', 4)).toThrow(PinInvalidoError);
    expect(() => validarFormaPin('4321', 4)).toThrow(PinInvalidoError);
    expect(() => validarFormaPin('123456', 6)).toThrow(PinInvalidoError);
    expect(() => validarFormaPin('654321', 6)).toThrow(PinInvalidoError);
  });

  it('acepta un PIN no obvio', () => {
    expect(() => validarFormaPin('482917', 6)).not.toThrow();
    expect(() => validarFormaPin('1573', 4)).not.toThrow();
  });

  it('rechaza vacío y demasiado largo', () => {
    expect(() => validarFormaPin('', 4)).toThrow(PinInvalidoError);
    expect(() => validarFormaPin('1234567890123', 4)).toThrow(PinInvalidoError);
  });
});

describe('largo según rol — D-06', () => {
  it('ADMIN y CAJA exigen 6 dígitos: autorizan dinero', () => {
    expect(largoMinimoParaRol('ADMIN')).toBe(6);
    expect(largoMinimoParaRol('CAJA')).toBe(6);
  });

  it('COCINA admite 4: no autoriza dinero', () => {
    expect(largoMinimoParaRol('COCINA')).toBe(4);
  });
});

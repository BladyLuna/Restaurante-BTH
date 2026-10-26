import { it, expect, beforeEach } from 'vitest';
import {
  normalizarTema,
  temaEfectivo,
  paletaDe,
  type Preferencia,
} from '../shared/ui/theme';

beforeEach(() => {});

it('acepta las tres preferencias y descarta basura', () => {
  expect(normalizarTema('claro')).toBe('claro');
  expect(normalizarTema('oscuro')).toBe('oscuro');
  expect(normalizarTema('sistema')).toBe('sistema');
  expect(normalizarTema('')).toBeNull();
  expect(normalizarTema('azul')).toBeNull();
  expect(normalizarTema(null)).toBeNull();
});

it('"sistema" sigue al sistema operativo; una eleccion explicita lo ignora', () => {
  expect(temaEfectivo('sistema', 'dark')).toBe('oscuro');
  expect(temaEfectivo('sistema', 'light')).toBe('claro');
  expect(temaEfectivo('sistema', null)).toBe('claro'); // sin dato, claro
  expect(temaEfectivo('oscuro', 'light')).toBe('oscuro');
  expect(temaEfectivo('claro', 'dark')).toBe('claro');
});

it('las dos paletas exponen exactamente las mismas claves', () => {
  const claro = Object.keys(paletaDe('claro')).sort();
  const oscuro = Object.keys(paletaDe('oscuro')).sort();
  expect(oscuro).toEqual(claro);
});

it('el modo oscuro invierte las superficies y no usa negro puro', () => {
  const claro = paletaDe('claro');
  const oscuro = paletaDe('oscuro');
  expect(oscuro.bg).not.toBe(claro.bg);
  expect(oscuro.bg.toUpperCase()).not.toBe('#000000');
  // El fondo oscuro debe ser mas oscuro que su texto; en claro, al reves.
  const luz = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  };
  expect(luz(oscuro.bg)).toBeLessThan(luz(oscuro.ink));
  expect(luz(claro.bg)).toBeGreaterThan(luz(claro.ink));
});

it('el texto principal mantiene contraste legible sobre su fondo en ambos temas', () => {
  // WCAG AA para texto normal pide 4.5:1. Esta app se usa a distancia de brazo
  // en una cocina: exigimos ese minimo en ambos temas.
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (
      0.2126 * canal((n >> 16) & 255) +
      0.7152 * canal((n >> 8) & 255) +
      0.0722 * canal(n & 255)
    );
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  for (const modo of ['claro', 'oscuro'] as const) {
    const p = paletaDe(modo);
    expect(ratio(p.ink, p.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(p.ink, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(p.muted, p.surface)).toBeGreaterThanOrEqual(4.5);
  }
});

it('el acento sigue siendo legible sobre el fondo en modo oscuro', () => {
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (
      0.2126 * canal((n >> 16) & 255) +
      0.7152 * canal((n >> 8) & 255) +
      0.0722 * canal(n & 255)
    );
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const p = paletaDe('oscuro');
  // 3:1 es el minimo AA para texto grande y elementos de interfaz.
  expect(ratio(p.accent, p.bg)).toBeGreaterThanOrEqual(3);
});

it('la preferencia por defecto es seguir al sistema', () => {
  const pref: Preferencia = 'sistema';
  expect(normalizarTema(pref)).toBe('sistema');
});

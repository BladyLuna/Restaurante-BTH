import { it, expect, beforeEach } from 'vitest';
import { normalizarApiUrl, getApiUrl, setApiUrlEnMemoria, apiUrlPorDefecto } from '../shared/api/config';

beforeEach(() => setApiUrlEnMemoria(null));

it('normaliza una IP suelta a http y puerto 3000', () => {
  expect(normalizarApiUrl('192.168.0.100')).toBe('http://192.168.0.100:3000');
  expect(normalizarApiUrl('  192.168.0.100  ')).toBe('http://192.168.0.100:3000');
});

it('respeta esquema y puerto escritos por la persona', () => {
  expect(normalizarApiUrl('http://192.168.0.100:3001')).toBe('http://192.168.0.100:3001');
  expect(normalizarApiUrl('https://api.local')).toBe('https://api.local');
  expect(normalizarApiUrl('http://192.168.0.100:3000/')).toBe('http://192.168.0.100:3000');
});

it('rechaza entradas que no sirven como direccion', () => {
  expect(normalizarApiUrl('')).toBeNull();
  expect(normalizarApiUrl('   ')).toBeNull();
  expect(normalizarApiUrl('no es una direccion')).toBeNull();
  expect(normalizarApiUrl('ftp://192.168.0.100')).toBeNull();
});

it('getApiUrl usa el valor guardado y si no el de por defecto', () => {
  expect(getApiUrl()).toBe(apiUrlPorDefecto());
  setApiUrlEnMemoria('http://192.168.0.55:3000');
  expect(getApiUrl()).toBe('http://192.168.0.55:3000');
  setApiUrlEnMemoria(null);
  expect(getApiUrl()).toBe(apiUrlPorDefecto());
});

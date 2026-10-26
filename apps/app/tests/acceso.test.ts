import { it, expect } from 'vitest';
import { destinoSegunRol } from '../features/domain';

it('cada rol entra directo a su trabajo, sin elegir sección', () => {
  expect(destinoSegunRol('COCINA')).toBe('/kds');
  expect(destinoSegunRol('CAJA')).toBe('/admin');
  expect(destinoSegunRol('ADMIN')).toBe('/admin');
});

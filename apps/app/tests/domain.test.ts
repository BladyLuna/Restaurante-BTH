import { describe, it, expect } from 'vitest';
import { amount, total, changeQuantity, payment, kitchenActions, uuid } from '../features/domain';
describe('pedido y cobro', () => {
 it('limita cantidades y elimina en cero', () => { expect(changeQuantity(1,-1)).toBe(0); expect(() => changeQuantity(99,1)).toThrow(); });
 it('exige selección y reserva diferencias a ADMIN con motivo', () => {
 expect(() => payment('',4500,'45','CAJA','')).toThrow();
 expect(payment('a',4500,'45','CAJA','').body).toEqual({orderId:'a',montoRecibido:4500});
 expect(() => payment('a',4500,'40','CAJA','ajuste')).toThrow();
 expect(() => payment('a',4500,'40','ADMIN','')).toThrow();
 expect(payment('a',4500,'40','ADMIN','Abono menor').path).toContain('con-diferencia');
 });
 it('respeta permisos compartidos de cocina', () => { expect(kitchenActions('PAGADO','ADMIN')).toEqual([]); expect(kitchenActions('PAGADO','COCINA')).toEqual(['EN_PREPARACION']); expect(kitchenActions('LISTO','CAJA')).toEqual(['ENTREGADO']); });
 it('genera UUID v4 con entropía inyectada sin randomUUID', () => { expect(uuid(a => a.fill(255))).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/); });
 it('convierte Bs enteros y calcula carrito sin flotantes', () => { expect(amount('45')).toBe(4500); expect(() => amount('45.5')).toThrow(); expect(total([{precio:4500,cantidad:2}])).toBe(9000); });
});

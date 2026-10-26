import {describe,it,expect} from 'vitest';
import {OrderSchemas} from '@restaurante/shared';
import {errorMessage} from '../shared/api/errors';
describe('mensajes de formulario',()=>{it('muestra el primer error de validación, no JSON técnico',()=>{const r=OrderSchemas.CrearPedido.safeParse({nombreCliente:'',tipo:'COMER_AQUI',intentoUuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',items:[{productId:'test-product',cantidad:1}]});if(r.success)throw new Error('fixture inválida');expect(errorMessage(r.error)).toBe('Poné tu nombre para que podamos llamarte');});it('preserva errores de API y da fallback',()=>{expect(errorMessage(new Error('Sin conexión'))).toBe('Sin conexión');expect(errorMessage(null)).toBe('No se pudo completar la operación');});});

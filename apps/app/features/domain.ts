import { PaymentSchemas, CANTIDAD_MAXIMA_POR_LINEA, transicionesDesde, actorPuedeTransicionar, type EstadoPedido, type Rol, Money } from '@restaurante/shared';
export function changeQuantity(n:number, delta:number) { const next=n+delta; if (!Number.isInteger(next) || next<0 || next>CANTIDAD_MAXIMA_POR_LINEA) throw new Error('Cantidad fuera del límite'); return next; }
export function payment(id:string, expected:number, input:string, role:Rol, reason:string) {
 const montoRecibido=amount(input); const different=montoRecibido!==expected;
 if (!['CAJA','ADMIN'].includes(role) || (different && role!=='ADMIN')) throw new Error('La diferencia requiere ADMIN');
 const body=different ? PaymentSchemas.ConfirmarConDiferencia.parse({orderId:id,montoRecibido,motivo:reason}) : PaymentSchemas.ConfirmarPago.parse({orderId:id,montoRecibido});
 return {path:'/admin/payments/'+(different?'confirmar-con-diferencia':'confirmar'),body};
}
export const kitchenActions=(state:EstadoPedido,role:Rol)=>transicionesDesde(state).filter(s=>['EN_PREPARACION','LISTO','ENTREGADO'].includes(s)&&actorPuedeTransicionar(state,s,role));
/** Tras entrar con PIN, el sistema lleva a cada persona a su puesto. Nadie elige sección. */
export const destinoSegunRol=(rol:Rol):'/kds'|'/admin'=>rol==='COCINA'?'/kds':'/admin';
export function uuid(random:(a:Uint8Array)=>Uint8Array = a => globalThis.crypto.getRandomValues(a)) { const b=random(new Uint8Array(16)); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128; const h=Array.from(b,n=>n.toString(16).padStart(2,'0')).join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
export const amount = (text: string) => Money.toCentavos(Money.parse(text));
export const money = (n: number) => Money.format(Money.fromCentavos(n));
export const total = (lines: readonly {precio:number;cantidad:number}[]) => Money.toCentavos(Money.sum(lines.map(l => Money.multiply(Money.fromCentavos(l.precio), l.cantidad))));

import type { EstadoPedido, Rol } from '@restaurante/shared';
export type User={id:string;nombre:string;rol:Rol;locationId:string};
export type Variant={id:string;nombre:string;precioCentavos:number;activo:boolean};
export type Product={id:string;nombre:string;descripcion:string|null;precioCentavos:number;imagenUrl:string|null;tieneVariantes:boolean;variantes:Variant[]};
export type Category={id:string;nombre:string;productos:Product[]};
export type Order={id:string;numero:number;estado:EstadoPedido;nombreCliente:string;tipo:string;total:number;creadoEn:string;qrImagenUrl?:string|null;minutosEspera?:number;items:{id:string;nombre?:string;nombreSnapshot?:string;cantidad:number;notas?:string|null}[]};
export type Line={productId:string;variantId?:string;nombre:string;precio:number;cantidad:number};

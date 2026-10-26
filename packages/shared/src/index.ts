/**
 * @restaurante/shared — kernel compartido
 *
 * Fuente: ARQUITECTURA §6.
 *
 * Dos reglas para que esto no se convierta en un basurero:
 *   1. Cero dependencias de infraestructura. Nada de Prisma, Nest ni React.
 *      Si no corre en un test unitario sin mocks, no va acá.
 *   2. Entra algo solo si el frontend y el backend lo necesitan. Si solo lo usa
 *      la API, va en la API.
 */

export * as Money from './money/money.js';
export type { Money as MoneyType } from './money/money.js';
export { MoneyError } from './money/money.js';

export * from './order/order-state.js';
export {
  calcularTotal,
  calcularLinea,
  describirErrorCalculo,
  CANTIDAD_MAXIMA_POR_LINEA,
  type LineaCalculo,
  type TotalPedido,
  type ErrorCalculo,
} from './order/order-total.js';

export * as Result from './result/result.js';
export type { Result as ResultType, Ok, Err } from './result/result.js';

export * as CatalogSchemas from './schemas/catalog.js';
export type {
  CrearCategoriaDto,
  ActualizarCategoriaDto,
  CrearProductoDto,
  ActualizarProductoDto,
  CrearVarianteDto,
  ActualizarVarianteDto,
  CambiarActivoDto,
  ReordenarDto,
  MimeFoto,
  SubirFotoDto,
} from './schemas/catalog.js';
export { MIMES_FOTO, FOTO_MAX_BYTES } from './schemas/catalog.js';

export * as SettingsSchemas from './schemas/settings.js';
export {
  MIMES_LOGO,
  LOGO_MAX_BYTES,
  type MimeLogo,
  type ActualizarBrandingDto,
  type LogoSubidoDto,
  type BrandingDto,
} from './schemas/settings.js';

export * as AuditSchemas from './schemas/audit.js';
export {
  GRUPOS_AUDITORIA,
  ACCIONES_POR_GRUPO,
  AUDITORIA_POR_PAGINA,
  AUDITORIA_DIAS_MAX,
  type GrupoAuditoria,
  type ConsultarAuditoriaDto,
  type EntradaAuditoriaDto,
  type ReporteAuditoriaDto,
} from './schemas/audit.js';

export * as OrderSchemas from './schemas/order.js';
export * as PaymentSchemas from './schemas/payment.js';
export type { ConfirmarPagoDto, ConfirmarConDiferenciaDto } from './schemas/payment.js';
export type {
  CrearPedidoDto,
  ItemPedidoDto,
  TipoConsumoDto,
} from './schemas/order.js';

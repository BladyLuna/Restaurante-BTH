# B9 — Backend mínimo de cocina

## Contrato para frontend

- `GET /kitchen/orders`: array, sesión Bearer ADMIN/CAJA/COCINA. Filtra por local del usuario autenticado, nunca acepta local desde el cliente. Solo PAGADO, EN_PREPARACION y LISTO; orden ascendente por pagadoEn, creadoEn e id.
- Campos: id, numero, estado, tipo, nombreCliente, total/subtotal (centavos), creadoEn/pagadoEn (ISO), minutosEspera calculados (null si falta fecha), items [{id,nombre,cantidad,precioUnitario,subtotal,notas}]. Nombre y precio vienen del snapshot, nunca del catálogo actual.
- `PATCH /kitchen/orders/:id/estado` con `{ "estado": "EN_PREPARACION" }`, LISTO o ENTREGADO. Devuelve el pedido con la misma forma. 400 cuerpo inválido, 401 sesión ausente/inválida, 403 actor/operación no autorizado, 404 pedido inexistente o ajeno, 409 transición inválida o carrera. Ante 409 reconstruir la cola por GET.
- No confirma pagos ni cancela pedidos. No crea devoluciones.

## Discrepancia documental que requiere decisión

S8 RQ-809/RQ-815 indica que COCINA no entrega. Sin embargo, `packages/shared/src/order/order-state.ts` permite LISTO → ENTREGADO a COCINA, CAJA y ADMIN. Por instrucción de conservar la máquina real, el endpoint respeta shared (sin modificarlo). Preparar y marcar listo son exclusivamente COCINA, ni siquiera ADMIN tiene esos permisos en shared. El frontend debe usar esa misma matriz. No declarar cumplida la aceptación de S8 que exige 403 al entregar con COCINA hasta reconciliar la documentación y la decisión de negocio.

Entrega escribe PEDIDO_ENTREGADO con usuario, IP y estados dentro de la misma transacción. Update condicional por estado evita duplicados/carreras: dos entregas simultáneas producen un 200, un 409 y un único registro. El modelo no tiene listoEn/entregadoEn: no se inventan campos ni migraciones; la fecha de entrega está en auditoría.

## CORS web/LAN

`main.ts` usa allowlist exacta `CORS_ORIGINS`, separada por comas. Ejemplo de configuración del proceso (no se modificó .env):

```
NODE_ENV=development
CORS_ORIGINS=http://192.168.1.20:8081,http://192.168.1.20:8082
```

Indicar el origen del frontend, no el de la API. Solo NODE_ENV=development agrega localhost y 127.0.0.1 en puertos 8081/8082. Producción sin allowlist no habilita orígenes cross-origin. No wildcard ni credenciales CORS; auth usa Authorization Bearer. Métodos incluyen PATCH, y preflight permite Authorization/Content-Type. Native no está sujeto a CORS. Cambios requieren reiniciar el proceso propio; no se alteraron procesos existentes.

## QR estático

Los tres caminos de reintento de creación (rápido, transaccional, recuperación UNIQUE) devuelven la imagen del PaymentQr asociado originalmente, aunque esté archivado y otro QR se haya activado. No hay integración bancaria ni CRUD QR. La inmutabilidad de imágenes referenciadas sigue siendo responsabilidad del futuro módulo QR.

## Evidencia

- TDD: GET primero devolvió 404; PATCH primero devolvió 404; retry QR primero devolvió null en lugar de /qr-original.png; test CORS detectó módulo faltante. Implementaciones posteriores pasaron.
- `npm test --workspace @restaurante/api`: 10 archivos, 178 tests pasaron, incluyendo HTTP Nest/Supertest + PostgreSQL real, permisos, local ajeno, snapshots, cola por pago, carrera de entrega y regresión QR.
- `npm run typecheck --workspace @restaurante/api`: exit 0.
- Nest AppModule completo se inicializa en tests HTTP, con @Inject explícito en los nuevos constructores.
- Prueba adicional de arranque `tsx src/main.ts` en puerto efímero: bloqueada por denegación de herramienta antes de ejecutarse; no se reintentó. Arranque standalone no verificado; sí integración Nest HTTP.
- Advertencia preexistente de Vite: API Node CJS deprecada.

## Pendientes / límites

No WebSocket B11/eventos, alertas sonoras, frontend, backups ni prueba física de WiFi/LAN. No se declara S8 completo. Cola HTTP permite polling/reconstrucción, pero no sustituye la aceptación WebSocket. No se modificaron payments, shared, frontend, dependencias, lockfile, .env ni PINs; sin commits.

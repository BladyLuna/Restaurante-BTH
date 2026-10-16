-- RQ-107 — Invariantes de dinero y de cobro a nivel de base de datos
--
-- Fuente: PLAN §4, PLAN §5b, D-04, D-08.
--
-- Por qué en la base y no solo en la aplicación: la validación de la app
-- protege del usuario, el CHECK protege del programador. Un seed, un script de
-- corrección manual o un bug en un servicio nuevo no pueden escribir un monto
-- con centavos. Es la única garantía que no depende de que alguien se acuerde.

-- Dinero: entero positivo y múltiplo de 100 (bolivianos enteros, D-04).
-- El sufijo de centavos fue derogado: cobrar Bs 45,42 cuando el plato dice
-- Bs 45 se percibe como abuso.

ALTER TABLE "products"
  ADD CONSTRAINT "products_precio_entero"
  CHECK ("precioBase" > 0 AND "precioBase" % 100 = 0);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "variants_precio_entero"
  CHECK ("precio" > 0 AND "precio" % 100 = 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "items_precio_entero"
  CHECK ("precioUnitarioSnapshot" >= 0 AND "precioUnitarioSnapshot" % 100 = 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "items_cantidad_positiva"
  CHECK ("cantidad" > 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_subtotal_entero"
  CHECK ("subtotal" >= 0 AND "subtotal" % 100 = 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_entero"
  CHECK ("total" >= 0 AND "total" % 100 = 0);

-- El monto efectivamente recibido también es entero. Puede ser 0 si el cliente
-- no pagó nada y se cancela.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_monto_recibido_entero"
  CHECK ("montoRecibido" IS NULL OR ("montoRecibido" >= 0 AND "montoRecibido" % 100 = 0));

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_monto_entero"
  CHECK ("monto" > 0 AND "monto" % 100 = 0);

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_montos_enteros"
  CHECK (
    ("montoEsperado" IS NULL OR ("montoEsperado" >= 0 AND "montoEsperado" % 100 = 0))
    AND
    ("montoRecibido" IS NULL OR ("montoRecibido" >= 0 AND "montoRecibido" % 100 = 0))
  );

-- Orden de catálogo y numeración no negativos.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_numero_positivo"
  CHECK ("numero" > 0);

ALTER TABLE "order_counters"
  ADD CONSTRAINT "counters_numero_no_negativo"
  CHECK ("ultimoNumero" >= 0);

-- Coherencia de estado: si un pedido está pagado, tiene fecha de pago y
-- autoría. Fuente: REPORTE C-03 — con dos personas habilitadas para confirmar,
-- un cobro sin autor no se puede auditar.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_pagado_tiene_autoria"
  CHECK (
    "estado" NOT IN ('PAGADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO')
    OR ("pagadoEn" IS NOT NULL AND "confirmadoPorId" IS NOT NULL)
  );

-- Si está cancelado, tiene fecha de cancelación.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_cancelado_tiene_fecha"
  CHECK ("estado" <> 'CANCELADO' OR "canceladoEn" IS NOT NULL);

-- Un refund cerrado tiene quién lo cerró y cuándo. Fuente: D-09 — el sistema
-- recuerda la obligación; cerrarla sin registrar quién devolvió la plata
-- vaciaría de sentido la tabla.
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_cerrado_tiene_autoria"
  CHECK (
    "estado" <> 'CERRADO'
    OR ("cerradoEn" IS NOT NULL AND "cerradoPorId" IS NOT NULL)
  );

-- Un QR archivado no puede estar activo: el kiosco mostraría un QR retirado.
ALTER TABLE "payment_qrs"
  ADD CONSTRAINT "qr_archivado_no_activo"
  CHECK (NOT ("archivado" = true AND "activo" = true));

-- A lo sumo un QR activo por local. Fuente: PLAN §5b.
-- Índice único parcial: Postgres lo hace cumplir incluso si dos pedidos de
-- activación llegan al mismo tiempo. El servicio igual debe validar que no
-- queden cero activos, porque eso no se puede expresar como constraint.
CREATE UNIQUE INDEX "qr_unico_activo_por_local"
  ON "payment_qrs" ("locationId")
  WHERE "activo" = true;

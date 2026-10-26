# Cómo levantar el proyecto

Sistema de pedidos por autoservicio para un restaurante: el cliente pide en una
tablet, paga por QR, caja confirma el pago y cocina lo prepara.

> **¿Vas a montarlo en Windows 11 desde cero?** Seguí
> [INSTALAR-WINDOWS.md](INSTALAR-WINDOWS.md), que cubre la instalación completa
> paso a paso. Lo de abajo asume Linux con Docker.

## Requisitos

    Node 20 o superior
    Docker con Compose

Verificado con Node 24.14, npm 11.11, Docker 29.8, Compose 5.5.

## Levantar el entorno

Primero la base y las dependencias:

    npm install
    docker compose up -d

    cd apps/api
    cp .env.example .env
    npx prisma generate
    npx prisma migrate deploy
    npx tsx prisma/seed.ts

La base queda en **localhost:5434** (no 5432 ni 5433, que suelen estar ocupados
por otros proyectos).

El seed imprime los PIN de desarrollo al final. Son de desarrollo: en el local
real los asigna la dueña desde el panel.

Después, en dos terminales separadas:

    cd apps/api && npx tsx src/main.ts        # API en localhost:3000
    cd apps/app && npx expo start --web       # pantallas en localhost:8081

Si la app pregunta por la dirección del servidor, poné `localhost` cuando todo
corre en la misma máquina. Desde otro dispositivo (una tablet real), la IP de
tu máquina en la red local.

## Las pantallas

    /kiosk        el cliente: elige, arma el pedido y recibe el QR
    /ingresar     login con PIN del personal
    /admin        caja: confirma los pagos
    /kds          cocina: cola de pedidos pagados
    /carta        la dueña: platos, precios, fotos, agotados
    /local        la dueña: nombre y logo del restaurante
    /auditoria    la dueña: quién cambió qué y cuándo
    /ajustes      dirección del servidor

El kiosco no pide login: lo opera el cliente. Todo lo demás sí, y cada rol ve
solo lo suyo.

## Correr los tests

    cd packages/shared && npx vitest run    # dominio puro, sin base
    cd apps/api && npx vitest run           # integración, requiere base levantada

Los de `shared` corren en cualquier parte. Los de `api` necesitan
`docker compose up -d` primero.

Hay tres scripts que prueban contra la API levantada, no son unit tests:

    bash probar.sh                      # recorrido completo: menú, PIN, roles, precios
    bash scripts/probar-fotos.sh        # fotos de platos y branding, 12 casos
    bash scripts/probar-auditoria.sh    # genera cambios reales y muestra el reporte

## Estado

    shared        121 tests
    api           186 tests

    auth          PIN con argon2, bloqueo tras 5 intentos
    catalog       carta, precios, fotos, dos vistas (pública y admin)
    orders        numeración transaccional, idempotencia, snapshot de precio
    payments      confirmación por monto, diferencias solo ADMIN
    kitchen       cola y avance de estados
    settings      nombre y logo del local
    audit         reporte de actividad, solo lectura
    app           kiosco, caja, cocina, carta, local y auditoría

Falta: subir fotos desde la app nativa (hoy se suben desde el navegador;
necesitaría `expo-image-picker` y recompilar el APK).

## Estructura

    packages/shared/     dominio puro: Money, máquina de estados, Result
    apps/api/            NestJS + Prisma
    apps/app/            Expo: kiosco, KDS, panel de la dueña
    scripts/             pruebas end-to-end contra la API levantada

## Tres cosas que conviene saber antes de tocar código

**Los montos son bolivianos enteros.** No hay centavos. El tipo `Money` lo
rechaza y la base tiene CHECK constraints que lo rechazan también. Si necesitás
un monto con centavos, estás contradiciendo una decisión de negocio, no un
detalle técnico.

**La auditoría de operaciones financieras se escribe dentro de la transacción**,
no por evento. Si ves un listener que escribe `AuditLog` de un cobro, es un bug:
un cobro que se guarda sin su registro de auditoría es exactamente el agujero
que el log existe para tapar.

**Los platos no se borran, se desactivan.** No hay endpoint de borrado y no es
un olvido: un plato borrado dejaría `OrderItem` huérfanos y rompería el
historial de pedidos. Lo que hay es "se acabó", que es reversible.

La documentación de diseño (plan, arquitectura, decisiones, sprints) no está en
el repo: contiene decisiones operativas y bancarias de una persona real.

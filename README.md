# Cómo levantar el proyecto

Sistema de pedidos por autoservicio. Documentación completa en `docs/`.

## Requisitos

    Node 20 o superior
    Docker con Compose

Verificado con Node 24.14, npm 11.11, Docker 29.8, Compose 5.5.

## Levantar el entorno

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

## Correr los tests

    cd packages/shared && npx vitest run    # dominio puro, sin base
    cd apps/api && npx vitest run           # integración, requiere base levantada

Los de `shared` corren en cualquier parte. Los de `api` necesitan
`docker compose up -d` primero.

## Estado

    B1 shared    terminado    68 tests
    B2 infra     terminado    18 tests de integración
    B3 auth      siguiente

Ver `docs/sprints/` para el detalle de cada sprint y `docs/decisiones/` para por
qué el sistema hace lo que hace.

## Estructura

    packages/shared/     dominio puro: Money, máquina de estados, Result
    apps/api/            NestJS + Prisma (en construcción)
    apps/app/            Expo: kiosco, KDS, admin (no iniciado)
    docs/                base de conocimiento

## Dos cosas que conviene saber antes de tocar código

**Los montos son bolivianos enteros.** No hay centavos. El tipo `Money` lo
rechaza y la base tiene CHECK constraints que lo rechazan también. Si necesitás
un monto con centavos, estás contradiciendo una decisión de negocio: leé
`docs/decisiones/README.md` D-04 antes de cambiarlo.

**La auditoría de operaciones financieras se escribe dentro de la transacción**,
no por evento. Si ves un listener que escribe `AuditLog` de un cobro, es un bug:
leé D-07.

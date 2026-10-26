# Levantar el proyecto en Windows 11 para la demo

Objetivo acotado: poner el sistema a andar en un Windows 11 sin nada instalado,
para mostrarlo en una presentación de ~30 minutos. No es una guía de despliegue
ni de desarrollo — es lo mínimo para que funcione y se pueda demostrar.

**Sin Docker y sin WSL2.** Para una demo no aportan nada: agregan reinicios,
varios GB de descarga y un NAT que complica la red. Todo nativo.

---

## Lo primero: no instales esto el día de la presentación

El riesgo real de esta guía no es técnico, es de cronograma. Una instalación
desde cero en Windows son **1 a 2 horas** contando descargas, y la mayor parte es
esperar. Si algo falla (red lenta, antivirus, falta de permisos de admin), se te
come la presentación.

- Hacé el montaje **completo un día antes**, en la misma máquina donde vas a
  presentar.
- Dejá la API y la app ya corriendo antes de que entre el tribunal.
- **Grabá un video de 3-4 minutos del flujo funcionando** como respaldo. Si falla
  la red o el proyector, mostrás el video y seguís hablando. Esto no es
  pesimismo: es lo que diferencia una defensa que se cae de una que no.

Si podés presentar desde tu propia máquina, donde ya funciona, hacelo. Esta guía
es para cuando no tenés esa opción.

---

## 1. Qué instalar (3 cosas)

Necesitás permisos de administrador.

### 1.1 Node 22 LTS

<https://nodejs.org> → instalador `.msi` de la versión LTS.

**Marcá la casilla "Automatically install the necessary tools for native
modules".** No es opcional: el proyecto usa `argon2` para hashear los PIN
(decisión D-06), que es un módulo nativo y se compila al instalarse. Sin esas
herramientas `npm install` falla con errores de `node-gyp` que no dicen nada útil.

Esa opción abre una ventana de PowerShell al final que descarga Build Tools y
Python. Tarda bastante. Dejala terminar.

### 1.2 PostgreSQL 16

<https://www.postgresql.org/download/windows/> → instalador de EDB.

Durante la instalación:
- Anotá la contraseña del superusuario `postgres`.
- Dejá el puerto en **5432** (el default).
- El resto, siguiente-siguiente.

Queda como servicio de Windows, así que arranca solo al encender.

> Antes de seguir, poné la **zona horaria del sistema en Bolivia**
> (Configuración → Hora e idioma). El cierre de jornada del sistema va de 05:00 a
> 05:00 (decisión D-14); si la máquina está en otra zona, los reportes del día se
> desfasan y te lo pueden preguntar justo en la demo.

### 1.3 Git para Windows

<https://git-scm.com/download/win> → siguiente-siguiente.

Trae **Git Bash**, que es lo que te va a dejar correr `probar.sh`. Sin eso ese
script no corre en Windows.

Verificá las tres cosas abriendo **Git Bash**:

    node -v     # v22.x
    npm -v
    git --version

---

## 2. Crear la base

Abrí **SQL Shell (psql)** desde el menú inicio. Te pregunta cuatro cosas, y a
las cuatro le das **Enter**: lo que está entre corchetes es el valor por defecto
y los cuatro son correctos.

    Server [localhost]:            <- Enter
    Database [postgres]:           <- Enter
    Port [5432]:                   <- Enter
    Username [postgres]:           <- Enter
    Password for user postgres:    <- la del paso 1.2

La contraseña es lo único que escribís. **No se ve nada mientras tipeás**, ni
asteriscos: es normal, escribila y dale Enter. Si entró bien, el prompt pasa a
`postgres=#`.

Pegá estas dos líneas **tal cual**, sin cambiar la contraseña:

    CREATE USER restaurante WITH PASSWORD 'restaurante_dev';
    CREATE DATABASE restaurante OWNER restaurante;

Tiene que responder `CREATE ROLE` y `CREATE DATABASE`. Cerrá la ventana.

> La contraseña va así, literal, porque es la que ya trae el `.env` del repo. Si
> le ponés otra, tenés que editar el `.env` en el paso 3 para que coincidan.

---

## 3. Traer el código y levantarlo

En **Git Bash**:

    cd ~
    git clone https://github.com/BladyLuna/Restaurante-BTH.git
    cd Restaurante-BTH
    npm install

El `.env` **viene incluido en el repo**: no hay que crearlo ni copiar ningún
archivo de ejemplo. Es un proyecto académico de demostración y sus valores son
de desarrollo, así que clonar y levantar es todo.

> **Sin internet en la máquina de la presentación?** Se puede llevar el repo en
> un USB como un solo archivo. En la máquina que lo tiene:
> `git bundle create ~/restaurante.bundle --all`, copiás ese archivo, y en
> Windows: `git clone ~/restaurante.bundle Restaurante-BTH`. Llega con todo el
> historial y sin `node_modules` (se reinstala con `npm install`).

`npm install` tarda varios minutos y es donde aparecen los problemas si algo
quedó mal en el paso 1.1.

### El único cambio al `.env`: el puerto

El `.env` trae el puerto **5434**, que es el de la base en Docker (así corre en
Linux). Acá Postgres está en **5432**, así que hay que cambiarlo:

    cd apps/api
    notepad .env

Cambiá `5434` por `5432` en la primera línea. Queda así:

    DATABASE_URL="postgresql://restaurante:restaurante_dev@localhost:5432/restaurante?schema=public"

Guardá y cerrá. **Nada más de ese archivo se toca**: `JWT_SECRET`, `PORT=3000`,
`NODE_ENV=development` y `CORS_ORIGINS` ya vienen con los valores que la demo
necesita.

> `NODE_ENV=development` es lo que habilita los orígenes de CORS del navegador.
> Si falta, la API arranca igual pero el login falla con un error de red que no
> menciona CORS en ninguna parte, y se pierde mucho tiempo buscando en el lugar
> equivocado.

### Migraciones y datos de prueba

    npx prisma generate
    npx prisma migrate deploy
    npx tsx prisma/seed.ts

El seed carga el menú de ejemplo y los usuarios, e **imprime los PIN al final.
Anotalos, los necesitás para la demo.**

### Arrancar la API

    npx tsx src/main.ts

Dejá esa terminal abierta. La API queda en <http://localhost:3000>.

Comprobá en el navegador que <http://localhost:3000/catalog> devuelva el menú en
JSON. Si eso anda, la base y la API están bien, y lo que falle después es de la
app, no del backend.

### Arrancar la app

Abrí **otra** terminal de Git Bash:

    cd ~/Restaurante-BTH/apps/app
    npx expo start --web

Se abre el navegador en <http://localhost:8081>. Para la demo esto alcanza: no
hace falta la tablet, ni compilar el APK, ni tocar el firewall.

Si la app pregunta por la dirección del servidor, poné **`localhost`**. Se cambia
desde la pantalla `/ajustes`.

---

## 4. Comprobar que anda, antes de presentar

En una tercera terminal de Git Bash:

    cd ~/Restaurante-BTH
    bash probar.sh

Hace el recorrido contra la base real: menú público, login por PIN de los tres
roles, PIN equivocado rechazado, permisos por rol, cambio de precio registrado y
bloqueo tras 5 intentos fallidos.

Hay dos scripts más, con la API levantada:

    bash scripts/probar-fotos.sh        # fotos de platos y logo del local
    bash scripts/probar-auditoria.sh    # genera cambios y muestra el reporte

Te sirven además **durante** la presentación: son la forma más rápida de mostrar
las reglas de permisos sin navegar por la interfaz.

### Las pantallas, para tener el recorrido claro

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

Antes de la demo conviene entrar a `/local` y cargar el **nombre y el logo** del
restaurante: aparecen en la cabecera de todas las pantallas, y un sistema con el
nombre del local se defiende mejor que uno que dice "Mi Restaurante".

---

## 5. Guion de arranque el día de la demo

Con todo ya instalado, para dejarlo andando:

1. Encendé la máquina. Postgres arranca solo (es servicio).
2. Git Bash → `cd ~/Restaurante-BTH/apps/api && npx tsx src/main.ts`
3. Otra Git Bash → `cd ~/Restaurante-BTH/apps/app && npx expo start --web`
4. Abrí las pestañas del navegador que vas a usar y dejalas cargadas.
5. Tené los PIN a mano, en papel.

Son 2-3 minutos. Hacelo antes de que entre el tribunal, no delante de ellos.

---

## 6. Si algo falla

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `npm install` falla con `node-gyp` / `argon2` | No se instalaron las herramientas nativas | Reinstalar Node marcando la casilla del paso 1.1 |
| `Can't reach database server at localhost:5434` | No cambiaste el puerto del `.env` | Poner 5432 (paso 3) |
| `authentication failed for user "restaurante"` | La contraseña del `CREATE USER` no coincide con la del `.env` | Volver a psql y repetir el `CREATE USER` con `restaurante_dev` |
| `prisma migrate` dice que la base no existe | Falló el paso 2 | Repetir el `CREATE DATABASE` en psql |
| La app carga pero el login no responde, o la consola del navegador habla de CORS | Falta `NODE_ENV=development` en el `.env` | Agregarlo y reiniciar la API |
| `probar.sh: command not found` | Lo corriste en PowerShell | Usar Git Bash |
| El navegador no muestra datos | La API no está corriendo | Verificar que la terminal del paso 3 siga viva |
| Puerto 3000 ocupado | Otro proceso lo tomó | Cambiar `PORT` en el `.env` |
| Puerto 5432 ocupado | Ya había otro Postgres instalado | Usar el puerto que eligió el instalador y ponerlo en el `.env` |
| Las fotos de platos no se suben | Estás en la app nativa, no en el navegador | Subirlas desde `/carta` en el navegador (ver nota al final) |

---

## 7. Checklist

    [ ] Node 22 instalado CON herramientas nativas
    [ ] PostgreSQL 16 corriendo en 5432
    [ ] Git Bash disponible
    [ ] zona horaria del sistema en Bolivia
    [ ] repo clonado (o traído por bundle si no hay internet)
    [ ] usuario y base `restaurante` creados
    [ ] npm install sin errores
    [ ] .env con el puerto cambiado a 5432
    [ ] migrate deploy y seed corridos
    [ ] PIN del seed anotados en papel
    [ ] localhost:3000/catalog devuelve el menú
    [ ] app abriendo en localhost:8081
    [ ] nombre y logo del local cargados en /local
    [ ] bash probar.sh pasa completo
    [ ] ensayo completo hecho un día antes
    [ ] video de respaldo grabado

---

## 8. Una limitación que conviene conocer antes de que la pregunten

**Las fotos de los platos se suben desde el navegador, no desde la app nativa.**
El selector de archivos usa el del navegador; en la app compilada haría falta
`expo-image-picker` y volver a generar el APK. Las fotos **se ven** en la tablet
sin problema — lo que no se puede es cargarlas desde ahí.

Para la demo en navegador no te afecta en nada: `/carta` sube fotos normalmente.
Si en la defensa te preguntan, la respuesta honesta es que la carga de imágenes
está resuelta en el panel web, que es donde la dueña administra, y que llevarla a
la app nativa es una dependencia más, no un rediseño.

# Recursos Canarias

Aplicacion web para un banco de recursos educativos dirigido a docentes de las Islas Canarias.

## Requisitos

- Node.js 20 o superior.
- No necesita instalar dependencias externas: el servidor usa solo modulos nativos de Node.

## Arranque local

```bash
npm start
```

La aplicacion queda disponible en:

```text
http://localhost:3000
```

Para usar otro puerto:

```bash
PORT=4000 npm start
```

## Variables de entorno

Copia el archivo de ejemplo si quieres configurar el entorno local:

```bash
cp .env.example .env
```

Variable disponible:

- PORT: puerto HTTP del servidor. Por defecto, 3000.

## Docker

Construir la imagen:

```bash
docker build -t recursos-canarias .
```

Ejecutar el contenedor:

```bash
docker run --rm -p 3000:3000 recursos-canarias
```

## Despliegue

### Railway, Render o Heroku compatible

El proyecto incluye:

- package.json con npm start.
- Procfile con web: node server.js.
- Dockerfile para despliegues basados en contenedor.

En la mayoria de plataformas basta con subir el repositorio y usar el comando:

```bash
npm start
```

No hace falta configurar variables para la primera version, salvo que quieras cambiar PORT.

## Estructura

- server.js: servidor Node sin dependencias externas.
- public/: interfaz web, estilos, imagenes y JavaScript del cliente.
- data/resources.json: recursos iniciales y nuevos recursos creados desde la app.
- package.json: scripts para terminal y despliegue.
- Dockerfile: ejecucion en contenedor.
- .env.example: variables configurables.
- Procfile: arranque para plataformas compatibles.

## Nota de produccion

En esta version los recursos creados desde la app se guardan en data/resources.json. Para produccion real conviene migrar ese almacenamiento a una base de datos, porque algunos servicios de despliegue no conservan cambios escritos en disco entre reinicios.

## Refresco de metadatos OG (cron)

Los recursos externos (`isExternal=true`) llevan metadatos Open Graph cacheados en `og`. Para mantenerlos al día sin tráfico de usuario, hay un endpoint admin protegido por token interno:

```text
POST /api/admin/refresh-stale-og
Authorization: Bearer $INTERNAL_CRON_TOKEN
```

Selecciona hasta 50 recursos con `og` ausente o `og.fetchedAt` anterior a 30 días y los reencola para que `ogQueue` los procese (SSRF-safe, throttled a 2 peticiones/segundo).

Configura `INTERNAL_CRON_TOKEN` en tu entorno (al menos 32 caracteres aleatorios). Ejemplo de cron del SO (Linux) para correr cada hora:

```cron
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $INTERNAL_CRON_TOKEN" https://tu-dominio.example/api/admin/refresh-stale-og >/dev/null
```

Sin token correcto (o si la variable de entorno no está configurada) el endpoint devuelve `401` sin filtrar información.

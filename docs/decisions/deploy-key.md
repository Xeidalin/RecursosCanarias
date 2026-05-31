# ADR: Patrón deployKey para comunicación servidor → Convex

**Estado**: Aceptado
**Fecha**: 2026-05-31
**Afecta a**: convex/blog.js, convex/subscribers.js, convex/tracking.js, convex/admins.js, convex/islandPages.js, convex/storage.js, server/routes/api-*.js

---

## Contexto

La aplicación usa un servidor Node.js separado (HTTP puro, sin框架) que se comunica con Convex a través de `ConvexHttpClient`. Las mutaciones y queries administrativas de Convex no deben ser accesibles públicamente desde clientes externos.

Convex ofrece `internalQuery`/`internalMutation` para funciones solo accesibles desde otras funciones Convex (acciones, queries internas). Sin embargo, `ConvexHttpClient` solo expone funciones **públicas** — no puede llamar a funciones `internal*`.

## Alternativas evaluadas

1. **`internalQuery`/`internalMutation`**: No viable. `ConvexHttpClient` no puede invocarlas.
2. **Convex HTTP Actions**: Requiere migrar toda la lógica del servidor Node.js a acciones HTTP de Convex. Refactor masivo que eliminaría la flexibilidad del servidor Node.js actual (middleware custom, rate limiting, SSR con templates, safeFetch, etc.).
3. **Token por operación (scoped secrets)**: Añade complejidad de gestión sin beneficio real de seguridad frente al patrón actual.
4. **`deployKey` como argumento (patrón actual)**: Una shared secret (`ADMIN_KEY`) conocida por el servidor y por el runtime de Convex. El servidor la lee de `process.env` y la pasa como argumento a cada mutación/query administrativa. La función Convex la compara en tiempo constante contra `process.env.ADMIN_KEY`.

## Decisión

Usamos el patrón **deployKey** (alternativa 4):

```
Servidor Node.js                  Convex function
─────────────────                ─────────────────
process.env.ADMIN_KEY ──→ requireDeployKey(args.deployKey)
  (nunca desde input del             │ compara contra
   cliente — siempre server-side)    │ process.env.ADMIN_KEY
```

- El valor **nunca** se lee del input del cliente. El servidor lo inyecta desde `process.env`.
- Los tests (`authz.test.js`) verifican que un `deployKey` enviado por el cliente no puede sobreescribir el valor del servidor.
- Las funciones Convex que no requieren autenticación (consultas públicas como `blog.list`, `blog.getBySlug`, `resources.list`) no reciben `deployKey`.

## Riesgo aceptado

El valor de `ADMIN_KEY` viaja como argumento en cada llamada administrativa a Convex. En un entorno con logging/tracing de argumentos de mutación, esto podría exponer la secret. Mitigaciones:

- Convex no persiste ni expone los argumentos de mutaciones en logs accesibles al desarrollador.
- El valor se compara en tiempo constante (`crypto.timingSafeEqual` en el servidor, comparación directa en Convex) para evitar timing attacks.
- En producción, rotar `ADMIN_KEY` periódicamente es trivial (solo dos lugares: `.env` del servidor y variables de entorno de Convex).

Si en el futuro Convex expone `internalQuery`/`internalMutation` a `ConvexHttpClient`, migraremos a ese mecanismo.

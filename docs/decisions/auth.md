# ADR: Auth, sesión, CSRF y rate limit

**Estado**: Aceptado  
**Fecha**: 2026-05-27  
**Afecta a**: T3 (implementación completa), T15 (admin frontend), T20 (tests de autorización)

---

## Contexto

El panel de administración necesita autenticación con protección contra:
- Robo de sesión (cookie insegura, HMAC débil)
- CSRF desde subdominos o páginas maliciosas
- Fuerza bruta en login
- Fuga de detalles de autenticación en errores

---

## Decisión

### 1. Cookie de sesión `rc_session`

**Formato**: `base64url(JSON payload).HMAC_SHA256(SESSION_SECRET, base64url(payload))`

```json
{ "adminId": "<id>", "kid": "<key-id>", "iat": <epoch_ms>, "exp": <epoch_ms> }
```

**Flags**: `HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`

`Secure` se activa cuando `NODE_ENV=production` (en producción siempre HTTPS).

**Rotación de clave**: el campo `kid` identifica qué clave se usó. Si se rota `SESSION_SECRET`, se mantiene la clave anterior activa unos días para sesiones existentes (la clave anterior se expone como `SESSION_SECRET_OLD`).

**Logout**: borra la cookie en el cliente (`Max-Age=0`). No hay lista negra de tokens en servidor (la expiración corta de 8 h mitiga el riesgo de tokens robados).

### 2. CSRF firmado y ligado a sesión

El token CSRF se calcula así:
```
csrfToken = HMAC_SHA256(SESSION_SECRET, sessionId + ":csrf")
```

Donde `sessionId` es el hash de la cookie completa (para que sea único por sesión sin almacenar estado en servidor).

**Flujo**:
1. Al completar el login, el servidor setea la cookie `rc_session` (HttpOnly) y la cookie `rc_csrf` (no HttpOnly, valor = csrfToken).
2. El JS del admin (`js/admin.js`) lee `rc_csrf` y lo envía como header `X-CSRF-Token` en cada petición mutating (POST/PUT/DELETE).
3. El servidor recalcula el HMAC desde la sesión actual y compara con `timingSafeEqual` contra el header `X-CSRF-Token`. También verifica la cookie `rc_csrf` como sanity check.
4. Cualquier divergencia → 403.

**Por qué funciona contra CSRF**:
- Un atacante en un subdominio puede setear cookies pero no leer el header `X-CSRF-Token` (SOP).
- El token deriva del `SESSION_SECRET` que solo conoce el servidor → no puede inyectarse.
- Al invalidar la sesión (logout o expiración), el CSRF token derivado también es inválido.

### 3. Rate limiting

Implementación: **token bucket en memoria** con ventana deslizante de 5 minutos.

Las IPs **solo viven en memoria para rate limiting** (ventana ≤5 min) y **nunca se persisten** en disco, logs ni Convex. El proceso mantiene un `Map<string, {tokens, lastReset}>` que se purga automáticamente.

| Endpoint | Límite |
|---|---|
| `POST /api/admin/login` | 5 intentos / 5 min / (IP + username) |
| `POST /api/subscribers` | 3 / 1 min / IP |
| `POST /api/contact` | 3 / 1 min / IP |
| `POST /api/track` | 30 / 1 min / IP |
| `POST /api/subscribers/unsubscribe` | 5 / 1 min / IP |

Al exceder el límite: HTTP 429 + `Retry-After` header.

### 4. Matriz pública/admin

Política **fail-closed**: cualquier endpoint sin etiqueta explícita se trata como admin.

| Acceso | Endpoints |
|---|---|
| **Público** | `GET /api/*`, `POST /api/subscribers`, `POST /api/contact`, `POST /api/track`, `POST /api/admin/login`, `POST /api/subscribers/unsubscribe`, `GET /unsubscribe` |
| **Admin** (sesión + CSRF en mutating) | `POST/PUT/DELETE /api/resources`, `POST/PUT/DELETE /api/blog`, `/api/admin/*` (excepto login/logout), `POST /api/admin/refresh-stale-og` |
| **Token interno** (cron) | `POST /api/admin/refresh-stale-og` — admite `Authorization: Bearer $INTERNAL_CRON_TOKEN` como alternativa a sesión admin |

---

## Flujo de autenticación

```
1. POST /api/admin/login  { username, password }
   ├─ rate limit (5/5min por IP+username) → 429 si excede
   ├─ convex.query(admins.getByUsername)
   ├─ scrypt verify (time-constant)
   ├─ Si falla → 401 (mensaje genérico, sin distinguir usuario/contraseña)
   └─ Si ok:
      ├─ Generar sessionId aleatorio (32 bytes, base64url)
      ├─ Crear payload + firmar con HMAC
      ├─ Set-Cookie: rc_session=<signed> HttpOnly SameSite=Lax Max-Age=28800
      ├─ Set-Cookie: rc_csrf=<csrfToken> SameSite=Lax Max-Age=28800
      └─ 200 { ok: true }

2. Cada request admin:
   ├─ requireAdmin middleware:
   │   ├─ Leer cookie rc_session
   │   ├─ Verificar HMAC (timingSafeEqual)
   │   ├─ Verificar exp > now
   │   └─ 401 si falla cualquier comprobación
   └─ requireCsrf middleware (solo en POST/PUT/DELETE):
       ├─ Leer header X-CSRF-Token
       ├─ Recalcular esperado desde SESSION_SECRET + sessionId
       ├─ timingSafeEqual(header, expected)
       └─ 403 si no coincide

3. POST /api/admin/logout
   ├─ Set-Cookie: rc_session=; Max-Age=0
   ├─ Set-Cookie: rc_csrf=; Max-Age=0
   └─ 200
```

---

## Almacenamiento de contraseñas

**scrypt** (Node nativo `crypto.scrypt`):
- `N=16384, r=8, p=1` — coste por defecto de Node
- Salt aleatorio de 32 bytes, generado en `scripts/create-admin.js`
- Almacenado en Convex: `{ passwordHash: "<hex>", salt: "<hex>" }`
- `hashPassword(pw, salt)` → devuelve hex
- `verifyPassword(pw, hash, salt)` → comparación con `timingSafeEqual`

---

## Amenazas mitigadas

| Amenaza | Mitigación |
|---|---|
| Robo de cookie via XSS | `HttpOnly` en `rc_session` |
| CSRF desde otro origen | CSRF token firmado + `SameSite=Lax` + header `X-CSRF-Token` |
| CSRF desde subdominio | Token deriva de SESSION_SECRET → no reproducible sin el secreto |
| Fuerza bruta login | Token bucket 5/5min por IP+username → 429 |
| Fuga de detalle (user vs pass) | Mensaje genérico "Credenciales incorrectas" en 401 |
| Replay de token expirado | Campo `exp` en payload firmado → 401 si exp < now |
| DNS rebinding en OG fetch | Ver `docs/decisions/sanitization.md` y `server/safeFetch.js` |
| Privilege escalation | Fail-closed: sin etiqueta → admin |

---

## Variables de entorno requeridas

```
SESSION_SECRET=<mínimo 32 bytes aleatorios, hex o base64>
SESSION_SECRET_OLD=<opcional, para rotación de claves>
INTERNAL_CRON_TOKEN=<token para el endpoint refresh-stale-og>
```

Generación sugerida: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Consecuencias

- **Positivo**: sin dependencias de sesiones externas (Redis, etc.) — todo en la cookie firmada.
- **Positivo**: CSRF token no requiere estado en servidor.
- **Negativo**: logout no invalida tokens robados hasta su expiración natural (8 h). Mitigado con `Max-Age` corto.
- **Negativo**: rate limit en memoria se pierde al reiniciar el proceso. Aceptable: el rate limit es para ataques en curso, no persistencia histórica.

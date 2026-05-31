# ADR: Política de sanitización (XSS)

**Estado**: Aceptado  
**Fecha**: 2026-05-27  
**Afecta a**: T1 (render SSR), T10 (markdown), T14-A/B (OG)

---

## Contexto

El proyecto mezcla varias fuentes de contenido con diferentes niveles de confianza:

1. **Contenido admin** (títulos, descripciones): editado por un admin autenticado.
2. **Cuerpo de blog** (markdown): puede incluir enlaces y código.
3. **Metadatos OG externos** (`og.title`, `og.description`, `og.image`): provienen de webs de terceros completamente no confiables.
4. **URLs externas** (`sourceUrl`, `externalUrl`, `og.image`, `og.favicon`): también no confiables.

Sin una política explícita, cualquiera de estas fuentes puede inyectar HTML/JS malicioso.

---

## Decisión

### 1. Motor de render SSR: solo `{{key}}` con escape obligatorio

El template engine usa únicamente interpolación `{{key}}` donde el valor **siempre** pasa por `escapeHtml()`. No existe una sintaxis `{{{raw}}}`.

El cuerpo del blog necesita HTML real. Para eso existe un slot especial `{{__body__}}` que el handler de blog rellena con el output del parser markdown controlado (`server/markdown.js`). Este slot es el **único** punto donde se inserta HTML sin escapar, y solo tras pasar por el AST del parser.

### 2. Markdown sin HTML crudo

El parser markdown **no acepta** etiquetas HTML embebidas. Cualquier `<` que no sea parte de un nodo markdown reconocido se escapa como texto (`&lt;`).

Allowlist de nodos permitidos:
- Texto, párrafo, encabezados h1–h3
- Listas ordenadas y desordenadas
- Énfasis (`strong`, `em`)
- Código en línea y bloques de código
- Citas (`blockquote`)
- Imágenes (con `safeUrl` sobre el src)
- Enlaces (con `safeUrl` sobre el href)

Nada más se renderiza como HTML. El resto se convierte en texto plano.

### 3. Módulo `server/sanitize.js`

Tres funciones exportadas:

#### `escapeHtml(str) → string`

Escapa los cinco caracteres fundamentales HTML: `& < > " '`. Devuelve string vacío si el input no es string. Nunca produce doble escape.

#### `stripHtml(str, maxLen = 300) → string`

Convierte HTML/texto con entidades a texto plano:
1. Decodifica entidades HTML (nombradas y numéricas, incluyendo hex).
2. Elimina todas las etiquetas `<...>`.
3. Colapsa espacios en blanco.
4. Trunca a `maxLen` caracteres.

Importante: si se pasa `&lt;b&gt;`, primero decodifica a `<b>` y luego elimina la etiqueta, resultando en string vacío. Esto es intencionado: evita que entidades encoded sean un bypass.

Usado para: `og.title`, `og.description`, cualquier texto de terceros antes de renderizar.

#### `safeUrl(href, context = "link") → string | null`

Valida y normaliza URLs para inserción segura en atributos HTML:

1. Recorta espacios extremos y decodifica entidades HTML básicas.
2. Rechaza caracteres de control (`\x00–\x1f`, `\x7f`) y espacios/tabs en cualquier posición.
3. Extrae el esquema con regex `^([a-zA-Z][a-zA-Z0-9+.-]*):` — si no hay esquema, rechaza (bloquea `//evil.com`).
4. Verifica el esquema contra una allowlist case-insensitive:
   - `"link"` (defecto): permite `http`, `https`, `mailto`.
   - `"img"`: solo `http`, `https`.
5. Valida con `new URL(href)` — si lanza, rechaza.
6. Segunda comprobación del scheme tras normalización de `URL()`.
7. Devuelve `url.toString()` (forma canónica) o `null`.

`null` significa "URL no segura — no renderizar".

Rechaza explícitamente: `javascript:`, `JaVaScRiPt:`, `data:`, `vbscript:`, `ftp:`, URLs relativas, protocol-relative (`//`), espacios/tabs/newlines en cualquier posición.

### 4. Sanitización de datos OG externos

| Campo | Función aplicada |
|---|---|
| `og.title` | `stripHtml(value, 200)` → luego `escapeHtml` al renderizar |
| `og.description` | `stripHtml(value, 300)` → luego `escapeHtml` al renderizar |
| `og.image` | `safeUrl(value, "img")` — null si no es segura |
| `og.favicon` | `safeUrl(value, "img")` — null si no es segura |
| `og.domain` | extraído con `new URL(sourceUrl).hostname` (no de la respuesta) |

### 5. Defensa en profundidad en cliente

Las cards del frontend también aplican `safeUrl` sobre `og.image` y `og.favicon` antes de asignar a `src`/`href`. Esto evita que datos corruptos en la base de datos lleguen al DOM incluso si el server los pasó.

---

## Tests (`scripts/test-sanitize.js`)

51 casos cubriendo:
- `escapeHtml`: 8 casos con los cinco caracteres especiales y XSS clásico.
- `stripHtml`: 11 casos incluyendo entidades nombradas, numéricas, hex, bypass via `&lt;`, colapso de espacios, truncado.
- `safeUrl` rechazados: 21 casos incluyendo todas las variantes de `javascript:`, `data:`, `vbscript:`, protocol-relative, espacios/tabs/newlines, caracteres de control, sin esquema.
- `safeUrl` aceptados: 8 casos de URLs válidas.
- `safeUrl` contexto img: 3 casos.

Ejecutar: `node scripts/test-sanitize.js` → debe terminar con código 0.

---

## Alternativas descartadas

### Usar DOMPurify en servidor

Requiere `jsdom` o similar (dependencia pesada), y la configuración de allowlists sigue siendo necesaria. Innecesario dado el control total sobre qué HTML se genera en el server.

### Librería marked/sanitize-html

Introduce dependencias y configuración externa. El parser propio (`server/markdown.js`) con AST controlado da las mismas garantías con cero dependencias adicionales.

---

## Consecuencias

- **Positivo**: superficie XSS mínima y auditable en ~100 líneas de código.
- **Positivo**: cero dependencias adicionales para sanitización.
- **Negativo**: el parser markdown propio es más trabajo que usar `marked`, pero permite control total.
- **Negativo**: `safeUrl` rechaza URLs legítimas con esquemas poco comunes (ftp, etc.). Aceptable dado el contexto educativo donde solo se necesitan http/https.

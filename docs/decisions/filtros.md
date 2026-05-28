# ADR: Modelo de filtros con tablas puente (junctions)

**Estado**: Aceptado  
**Fecha**: 2026-05-27  
**Afecta a**: T2 (schema Convex), T7 (página recursos), T8 (páginas isla)

---

## Contexto

El catálogo de recursos necesita filtrado combinado por isla, temática y nivel educativo. Cada recurso puede pertenecer a **varias islas, varias temáticas y varios niveles** simultáneamente (campos array). La operación necesaria es:

> "Dame todos los recursos donde `islands` contenga `'tenerife'` Y `topics` contenga `'naturaleza'`"

Convex `searchIndex.filterFields` solo admite **igualdad sobre campos escalares**. No existe una operación nativa `array.includes(value)` eficiente en Convex. Iterar `ctx.db.query("resources").collect()` y filtrar en memoria escala mal más allá de unos pocos cientos de documentos.

---

## Decisión

Introducir **tres tablas puente** (junction tables) que normalizan la relación N:M entre recursos y cada faceta:

```
resourceIslands  (resourceId, islandSlug)
resourceTopics   (resourceId, topicSlug)
resourceLevels   (resourceId, levelSlug)
```

Cada tabla tiene dos índices: `by_<faceta>` (para filtrar por valor) y `by_resource` (para limpiar al borrar/actualizar el recurso).

Los arrays `islands`, `topics`, `levels` se mantienen en el documento `resources` como datos de lectura (las cards los necesitan para mostrar badges). Las tablas puente son la fuente de verdad para el filtrado.

---

## Regla "todas las islas"

Si un recurso se marca como `islands: ["todas"]`, la mutation **expande** automáticamente las junctions insertando una fila por cada isla concreta:

```
tenerife | gran-canaria | lanzarote | fuerteventura | la-palma | la-gomera | el-hierro
```

El campo `islands` del documento sigue siendo `["todas"]` (para mostrar el badge correcto en la card). Al filtrar por `tenerife`, el recurso aparece porque existe la fila `(resourceId, "tenerife")` en `resourceIslands`.

Si en el futuro se añade una isla nueva, se hace un backfill reexpandiendo estos recursos.

Para `topics` y `levels` no existe la opción "todos"; cada recurso tiene al menos un valor concreto.

---

## Pipeline de filtros (`listFiltered`)

```
listFiltered({ kind?, islands?, topics?, levels?, q?, cursor?, limit? })
```

**Paso 1 — Candidatos por faceta (OR dentro de cada faceta)**

Para cada array no vacío en `{islands, topics, levels}`:
- Consultar la tabla puente con `withIndex("by_<faceta>", q => q.eq("<faceta>Slug", value))` por cada valor.
- Unir los `resourceId` resultantes → OR dentro de la misma faceta.

**Paso 2 — Intersección entre facetas (AND)**

Intersectar los conjuntos de IDs de cada faceta. El recurso con `islands=["todas"]` ya está expandido en las junctions, así que aparece correctamente al filtrar por una isla concreta.

**Paso 3 — Búsqueda textual (opcional)**

Si hay `q`:
- Ejecutar `ctx.db.query("resources").withSearchIndex("search_resources_title", b => b.search("title", q).eq("kind", kind))`.
- Intersectar con el conjunto del paso 2.

**Paso 4 — Ordenación**

Sin `q`: ordenar el conjunto candidato por `_creationTime` desc (número autogenerado por Convex, monotónico). Tie-break por `_id` asc para evitar duplicados cuando varios documentos tienen el mismo timestamp.

Con `q`: el searchIndex ya ordena por relevancia; no se aplica orden cronológico adicional.

**Paso 5 — Cursor**

El cursor es el par `(creationTime, _id)` codificado en base64url:

```js
// Encode
const cursor = Buffer.from(JSON.stringify({ ct: doc._creationTime, id: doc._id }))
  .toString("base64url");

// Decode y aplicar en siguiente página:
// WHERE _creationTime < cursorCt
//    OR (_creationTime === cursorCt AND _id > cursorId)
```

Esto garantiza páginas sin saltos ni duplicados incluso cuando varios documentos comparten el mismo `_creationTime`.

**Paso 6 — Carga**

`ctx.db.get(id)` para cada id de la página (default `limit = 24`). Solo se cargan los documentos de la página actual, no todo el conjunto.

---

## Definición de índices

```js
resourceIslands: defineTable({
  resourceId: v.id("resources"),
  islandSlug: v.string()
})
.index("by_island", ["islandSlug"])
.index("by_resource", ["resourceId"]),

resourceTopics: defineTable({
  resourceId: v.id("resources"),
  topicSlug: v.string()
})
.index("by_topic", ["topicSlug"])
.index("by_resource", ["resourceId"]),

resourceLevels: defineTable({
  resourceId: v.id("resources"),
  levelSlug: v.string()
})
.index("by_level", ["levelSlug"])
.index("by_resource", ["resourceId"]),
```

El orden `_creationTime desc` se aplica **en la query** (`.order("desc")`), no se declara en la definición del índice. Las tablas puente no incluyen `createdAt` propio; se usa el `_creationTime` autogenerado de Convex.

---

## Helper `syncFacets`

Las mutations `createResource` y `updateResource` mantienen las junctions en coherencia mediante un helper idempotente:

```js
async function syncFacets(ctx, resourceId, { islands, topics, levels }) {
  // 1. Borrar junctions existentes para este recurso
  for (const table of ["resourceIslands", "resourceTopics", "resourceLevels"]) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_resource", q => q.eq("resourceId", resourceId))
      .collect();
    await Promise.all(rows.map(r => ctx.db.delete(r._id)));
  }

  // 2. Expandir "todas" para islas
  const ISLAND_SLUGS = [
    "tenerife", "gran-canaria", "lanzarote",
    "fuerteventura", "la-palma", "la-gomera", "el-hierro"
  ];
  const islandSlugs = islands.includes("todas") ? ISLAND_SLUGS : islands;

  // 3. Insertar nuevas filas
  await Promise.all(islandSlugs.map(s =>
    ctx.db.insert("resourceIslands", { resourceId, islandSlug: s })
  ));
  await Promise.all(topics.map(s =>
    ctx.db.insert("resourceTopics", { resourceId, topicSlug: s })
  ));
  await Promise.all(levels.map(s =>
    ctx.db.insert("resourceLevels", { resourceId, levelSlug: s })
  ));
}
```

Al borrar un recurso (`removeResource`), se llama también `syncFacets` con arrays vacíos para limpiar las junctions.

---

## Límite de escalado

Este patrón funciona bien hasta **~10.000 recursos**. El coste de cada query de faceta es O(valores × log N) sobre las tablas puente. Por encima de ese límite, las opciones son:

1. Precomputar pares (islandSlug, topicSlug) en una tabla adicional.
2. Migrar el filtrado a un motor de búsqueda externo (Algolia, Typesense).

En el horizonte previsto del proyecto (2 años), no se espera superar ese límite.

---

## Alternativas descartadas

### A1 — Filtrado en memoria tras `collect()`

Cargar todos los recursos y filtrar en JS. Simple pero inescalable: O(N) en cada query, y Convex cobra por documentos leídos. Descartado.

### A2 — Arrays en `filterFields` del searchIndex

Convex `filterFields` en `searchIndex` solo admite escalares. No existe soporte nativo para `array.includes`. Descartado.

### A3 — Campo concatenado `island_topic` (índice compuesto)

Crear un campo string `"tenerife:naturaleza"` y buscar por igualdad exacta. No escala con múltiples valores simultáneos ni con OR dentro de una faceta. Descartado.

### A4 — Convex con múltiples índices en el mismo campo

Convex no permite múltiples índices sobre el mismo campo array. Descartado.

---

## Consecuencias

- **Positivo**: filtrado eficiente por índice, sin `collect()` masivos.
- **Positivo**: la lógica de "todas las islas" queda encapsulada en `syncFacets`.
- **Negativo**: al actualizar un recurso hay que borrar y reinsertar las junctions (coste de escritura mayor, pero aceptable).
- **Negativo**: el pipeline de intersección en memoria sobre los conjuntos de IDs crece con el número de recursos candidatos; se mitiga con el límite de ~10k documentos.

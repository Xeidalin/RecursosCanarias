#!/usr/bin/env node
"use strict";

/**
 * Migra data/resources.json del shape v1 al shape v2 (schema Convex v2).
 *
 * Mapeos:
 *   type    → kind  (Imagen→"image", PDF→"pdf", Video→"video", Ficha|Tarea→"activity",
 *                    Presentacion→"presentation", Audio→"audio", Cancion→"song")
 *   island  → islands  ("Canarias"→["todas"], otros→[slugify(island)])
 *   subject → topics   [slugify(subject)] + stage como topic adicional
 *   level   → levels   [slugify(level)]
 *   title   → slug autogenerado
 *   fileUrl → isExternal (# o vacío → false; URL http no propia → true)
 */

const fs   = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers de slug y mapeo
// ---------------------------------------------------------------------------

function slugify(str) {
  return String(str || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // quitar acentos
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

const KIND_MAP = {
  "imagen":        "image",
  "pdf":           "pdf",
  "video":         "video",
  "audio":         "audio",
  "presentacion":  "presentation",
  "cancion":       "song",
  "ficha":         "activity",
  "tarea":         "activity",
  "actividad":     "activity",
};

function mapKind(type) {
  return KIND_MAP[String(type || "").toLowerCase()] || "activity";
}

function mapIslands(island) {
  const s = String(island || "").trim().toLowerCase();
  if (!s || s === "canarias" || s === "todas las islas" || s === "todas") return ["todas"];
  return [slugify(island)];
}

const LEVEL_MAP = {
  "1 año":   "infantil-1",
  "2 años":  "infantil-2",
  "3 años":  "infantil-3",
  "4 años":  "infantil-4",
  "5 años":  "infantil-5",
  "1º":      "1-primaria",
  "2º":      "2-primaria",
  "3º":      "3-primaria",
  "4º":      "4-primaria",
  "5º":      "5-primaria",
  "6º":      "6-primaria",
  "1º eso":  "1-eso",
  "2º eso":  "2-eso",
  "3º eso":  "3-eso",
  "4º eso":  "4-eso",
  "1º bach": "1-bachillerato",
  "2º bach": "2-bachillerato",
  "programacion": "docentes",
};

function mapLevel(level) {
  const key = String(level || "").trim().toLowerCase();
  return LEVEL_MAP[key] || slugify(level) || "todos";
}

const STAGE_TOPIC_MAP = {
  "infantil":  "infantil",
  "primaria":  "primaria",
  "secundaria":"secundaria",
  "bachillerato":"bachillerato",
  "fp":        "fp",
  "docentes":  "docentes",
};

function mapStage(stage) {
  return STAGE_TOPIC_MAP[String(stage || "").trim().toLowerCase()] || null;
}

function deduceIsExternal(fileUrl) {
  if (!fileUrl || fileUrl === "#" || fileUrl.trim() === "") return false;
  try {
    const u = new URL(fileUrl);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function ensureUniqueSlug(slug, usedSlugs) {
  let candidate = slug;
  let i = 2;
  while (usedSlugs.has(candidate)) {
    candidate = `${slug}-${i++}`;
  }
  usedSlugs.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Validación del shape v2
// ---------------------------------------------------------------------------

const VALID_KINDS = new Set(["pdf","image","song","audio","video","presentation","activity"]);
const VALID_ISLANDS = new Set(["tenerife","gran-canaria","lanzarote","fuerteventura","la-palma","la-gomera","el-hierro","todas"]);

function validateResource(r) {
  const errors = [];
  if (!r.slug)         errors.push("falta slug");
  if (!r.title)        errors.push("falta title");
  if (!VALID_KINDS.has(r.kind)) errors.push(`kind inválido: ${r.kind}`);
  if (typeof r.isExternal !== "boolean") errors.push("isExternal no es boolean");
  if (!Array.isArray(r.islands) || r.islands.length === 0) errors.push("islands vacío");
  for (const isl of r.islands) {
    if (!VALID_ISLANDS.has(isl)) errors.push(`isla inválida: ${isl}`);
  }
  if (!Array.isArray(r.topics) || r.topics.length === 0) errors.push("topics vacío");
  if (!Array.isArray(r.levels) || r.levels.length === 0) errors.push("levels vacío");
  if (typeof r.description !== "string") errors.push("falta description");
  if (typeof r.imageUrl !== "string")    errors.push("falta imageUrl");
  if (typeof r.license !== "string")     errors.push("falta license");
  if (!Array.isArray(r.tags))            errors.push("tags no es array");
  if (typeof r.views !== "number")       errors.push("falta views");
  if (typeof r.downloads !== "number")   errors.push("falta downloads");
  if (!r.createdAt)    errors.push("falta createdAt");
  return errors;
}

// ---------------------------------------------------------------------------
// Migración principal
// ---------------------------------------------------------------------------

function migrate(v1Items) {
  const usedSlugs = new Set();
  return v1Items.map((item) => {
    const slug    = ensureUniqueSlug(slugify(item.title), usedSlugs);
    const kind    = mapKind(item.type);
    const islands = mapIslands(item.island);
    const level   = mapLevel(item.level);
    const topic   = slugify(item.subject) || "general";
    const stage   = mapStage(item.stage);
    const topics  = stage && stage !== topic ? [topic, stage] : [topic];
    const levels  = [level];

    const isExternal = deduceIsExternal(item.fileUrl);
    const fileUrl    = (!item.fileUrl || item.fileUrl === "#") ? "" : item.fileUrl;
    const sourceUrl  = isExternal ? item.fileUrl : "";

    return {
      slug,
      title:       item.title,
      kind,
      isExternal,
      sourceUrl,
      fileUrl,
      islands,
      topics,
      levels,
      description: item.description || "",
      imageUrl:    item.imageUrl    || "",
      license:     item.license     || "Uso educativo",
      tags:        item.tags        || [],
      og:          null,
      views:       0,
      downloads:   0,
      createdAt:   item.createdAt   || new Date().toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Recursos externos adicionales (con URL real, og se enriquecerá luego)
// ---------------------------------------------------------------------------

const EXTRA_EXTERNAL = [
  {
    slug:        "parque-nacional-teide-programa-educativo",
    title:       "Programa educativo del Parque Nacional del Teide",
    kind:        "activity",
    isExternal:  true,
    sourceUrl:   "https://www.miteco.gob.es/es/red-parques-nacionales/nuestros-parques/teide/educacion.html",
    fileUrl:     "",
    islands:     ["tenerife"],
    topics:      ["naturaleza", "ciencias-naturales"],
    levels:      ["5-primaria", "6-primaria", "1-eso", "2-eso"],
    description: "Propuestas educativas del Parque Nacional del Teide para escolares.",
    imageUrl:    "",
    license:     "Uso educativo",
    tags:        ["teide", "parque-nacional", "naturaleza", "volcanes"],
    og:          null,
    views:       0,
    downloads:   0,
    createdAt:   "2026-05-27T00:00:00.000Z",
  },
  {
    slug:        "reserva-biosfera-lanzarote-educacion",
    title:       "Reserva de la Biosfera de Lanzarote — Recursos educativos",
    kind:        "activity",
    isExternal:  true,
    sourceUrl:   "https://www.lanzarotebiosphere.es/educacion",
    fileUrl:     "",
    islands:     ["lanzarote"],
    topics:      ["naturaleza", "ciencias-naturales"],
    levels:      ["3-primaria", "4-primaria", "5-primaria", "1-eso"],
    description: "Materiales educativos sobre la Reserva de la Biosfera de Lanzarote para centros escolares.",
    imageUrl:    "",
    license:     "Uso educativo",
    tags:        ["lanzarote", "biosfera", "sostenibilidad", "medio-ambiente"],
    og:          null,
    views:       0,
    downloads:   0,
    createdAt:   "2026-05-27T00:00:00.000Z",
  },
  {
    slug:        "garajonay-educacion-ambiental-laurisilva",
    title:       "Garajonay — Educación ambiental en la laurisilva",
    kind:        "activity",
    isExternal:  true,
    sourceUrl:   "https://www.miteco.gob.es/es/red-parques-nacionales/nuestros-parques/garajonay/educacion.html",
    fileUrl:     "",
    islands:     ["la-gomera"],
    topics:      ["naturaleza", "ciencias-naturales"],
    levels:      ["3-primaria", "4-primaria", "5-primaria", "6-primaria"],
    description: "Programa de educación ambiental del Parque Nacional de Garajonay en La Gomera.",
    imageUrl:    "",
    license:     "Uso educativo",
    tags:        ["garajonay", "laurisilva", "la-gomera", "naturaleza"],
    og:          null,
    views:       0,
    downloads:   0,
    createdAt:   "2026-05-27T00:00:00.000Z",
  },
  {
    slug:        "caldera-taburiente-programa-escolar",
    title:       "Caldera de Taburiente — Programa escolar",
    kind:        "activity",
    isExternal:  true,
    sourceUrl:   "https://www.miteco.gob.es/es/red-parques-nacionales/nuestros-parques/la-palma/educacion.html",
    fileUrl:     "",
    islands:     ["la-palma"],
    topics:      ["naturaleza", "geologia"],
    levels:      ["5-primaria", "6-primaria", "1-eso", "2-eso"],
    description: "Actividades educativas del Parque Nacional de la Caldera de Taburiente.",
    imageUrl:    "",
    license:     "Uso educativo",
    tags:        ["la-palma", "caldera", "parque-nacional", "geologia"],
    og:          null,
    views:       0,
    downloads:   0,
    createdAt:   "2026-05-27T00:00:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// Ejecutar
// ---------------------------------------------------------------------------

function main() {
  const srcPath = path.join(ROOT, "data", "resources.json");
  const outPath = path.join(ROOT, "data", "resources.json");

  // Leer original desde git si no existe en disco
  let v1Data;
  const gitCmd = "git show HEAD:data/resources.json";
  try {
    const { execSync } = require("node:child_process");
    v1Data = JSON.parse(execSync(gitCmd, { cwd: ROOT }).toString("utf8"));
    console.log(`Leídos ${v1Data.length} recursos del historial git.`);
  } catch {
    // Si falla git, intenta leer del disco
    try {
      v1Data = JSON.parse(fs.readFileSync(srcPath, "utf8"));
      console.log(`Leídos ${v1Data.length} recursos de ${srcPath}.`);
    } catch {
      console.error("No se encontró data/resources.json ni en git ni en disco.");
      process.exit(1);
    }
  }

  const migrated = migrate(v1Data);
  const all      = [...migrated, ...EXTRA_EXTERNAL];

  // Validar todos
  let hasErrors = false;
  for (const r of all) {
    const errs = validateResource(r);
    if (errs.length > 0) {
      console.error(`✗ ${r.slug}: ${errs.join(", ")}`);
      hasErrors = true;
    } else {
      console.log(`  ✓ ${r.slug}  (${r.kind}, islands:${r.islands.join("+")}, topics:${r.topics.join("+")}, levels:${r.levels.join("+")})`);
    }
  }

  if (hasErrors) {
    console.error("\nHay errores de validación. Corrígelos antes de continuar.");
    process.exit(1);
  }

  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n", "utf8");

  const extCount = all.filter((r) => r.isExternal).length;
  const ownCount = all.filter((r) => !r.isExternal).length;
  console.log(`\n✓ Generados ${all.length} recursos → ${outPath}`);
  console.log(`  Externos: ${extCount}  Propios: ${ownCount}`);
}

main();

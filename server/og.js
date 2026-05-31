"use strict";

const { stripHtml, safeUrl } = require("./sanitize.js");

const MAX_TEXT = 300;

// ---------------------------------------------------------------------------
// Tag extractors — regex deliberadamente acotadas a etiquetas <head>.
// No intentamos parsear HTML completo: solo metaetiquetas estructuradas.
// ---------------------------------------------------------------------------

function getHead(html) {
  const m = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  return m ? m[1] : html;
}

/**
 * Devuelve el primer atributo `content` de un <meta> cuyo `property`/`name`
 * (case-insensitive) coincide con `key`. Acepta comillas simples, dobles, o
 * comillas mixtas pero rechaza mezclas inválidas.
 */
function metaContent(head, attr, key) {
  // Busca <meta ... attr="key" ... content="..."> en cualquier orden
  const reA = new RegExp(
    `<meta\\b[^>]*\\b${attr}\\s*=\\s*(['"])\\s*${key}\\s*\\1[^>]*\\bcontent\\s*=\\s*(['"])([\\s\\S]*?)\\2`,
    "i"
  );
  const reB = new RegExp(
    `<meta\\b[^>]*\\bcontent\\s*=\\s*(['"])([\\s\\S]*?)\\1[^>]*\\b${attr}\\s*=\\s*(['"])\\s*${key}\\s*\\3`,
    "i"
  );
  const a = head.match(reA);
  if (a) return a[3];
  const b = head.match(reB);
  if (b) return b[2];
  return null;
}

function titleTag(head) {
  const m = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return m ? m[1] : null;
}

/**
 * Devuelve el href del primer <link rel="...icon..."> encontrado.
 * Cubre rel="icon", "shortcut icon", "apple-touch-icon".
 */
function linkIcon(head) {
  const reA = /<link\b[^>]*\brel\s*=\s*(['"])([^'"]*\bicon\b[^'"]*)\1[^>]*\bhref\s*=\s*(['"])([\s\S]*?)\3/i;
  const reB = /<link\b[^>]*\bhref\s*=\s*(['"])([\s\S]*?)\1[^>]*\brel\s*=\s*(['"])([^'"]*\bicon\b[^'"]*)\3/i;
  const a = head.match(reA);
  if (a) return a[4];
  const b = head.match(reB);
  if (b) return b[2];
  return null;
}

// ---------------------------------------------------------------------------
// safeUrl con resolución relativa al documento
// ---------------------------------------------------------------------------

function resolveAndSafe(href, baseUrl, context = "img") {
  if (typeof href !== "string") return "";
  let absolute;
  try {
    absolute = new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
  return safeUrl(absolute, context) ?? "";
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Extrae metadatos OG saneados de un documento HTML.
 *
 * Garantías:
 *  - title/description sin HTML, truncados a 300 chars (stripHtml).
 *  - image/favicon validados por safeUrl(context="img") tras resolver con la URL final.
 *  - Strings vacíos cuando no hay dato disponible (no null/undefined).
 *  - failed=false significa éxito de extracción aunque algún campo falte.
 *
 * @param {string} html      HTML completo del recurso externo.
 * @param {string} finalUrl  URL final tras redirects (para resolver relativos).
 * @returns {{title,description,image,favicon,domain,fetchedAt,failed}}
 */
function parseOg(html, finalUrl) {
  const fetchedAt = new Date().toISOString();
  const fail = (extra) => ({
    title: "", description: "", image: "", favicon: "", domain: "",
    fetchedAt, failed: true, ...extra,
  });

  if (typeof html !== "string" || typeof finalUrl !== "string") return fail();

  let domain = "";
  try { domain = new URL(finalUrl).hostname; } catch { return fail(); }

  const head = getHead(html);

  const rawTitle =
    metaContent(head, "property", "og:title") ??
    metaContent(head, "name",     "og:title") ??
    metaContent(head, "name",     "twitter:title") ??
    titleTag(head) ?? "";

  const rawDescription =
    metaContent(head, "property", "og:description") ??
    metaContent(head, "name",     "og:description") ??
    metaContent(head, "name",     "twitter:description") ??
    metaContent(head, "name",     "description") ?? "";

  const rawImage =
    metaContent(head, "property", "og:image:secure_url") ??
    metaContent(head, "property", "og:image") ??
    metaContent(head, "name",     "twitter:image") ?? "";

  const rawIcon = linkIcon(head) ?? "";

  const title       = stripHtml(rawTitle, MAX_TEXT);
  const description = stripHtml(rawDescription, MAX_TEXT);
  const image       = rawImage ? resolveAndSafe(rawImage, finalUrl, "img") : "";
  const favicon     = rawIcon
    ? resolveAndSafe(rawIcon, finalUrl, "img")
    : resolveAndSafe("/favicon.ico", finalUrl, "img");

  return { title, description, image, favicon, domain, fetchedAt, failed: false };
}

module.exports = { parseOg };

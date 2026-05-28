"use strict";

// Mapa de entidades HTML comunes para decode
const HTML_ENTITIES = {
  "&amp;":  "&",
  "&lt;":   "<",
  "&gt;":   ">",
  "&quot;": '"',
  "&#39;":  "'",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&#47;":  "/",
};

/**
 * Escapa caracteres especiales HTML para inserción segura en atributos y texto.
 * No produce "doble escape" porque solo escapa los cinco caracteres fundamentales.
 */
function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convierte HTML a texto plano: elimina etiquetas y decodifica entidades.
 * Usado para contenido externo (og.title, og.description) antes de renderizar.
 * Trunca a `maxLen` caracteres.
 */
function stripHtml(str, maxLen = 300) {
  if (typeof str !== "string") return "";
  // Decodificar entidades nombradas y numéricas
  let out = str.replace(
    /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z]+));/g,
    (match, hex, dec, name) => {
      if (name) return HTML_ENTITIES["&" + name + ";"] ?? match;
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      // Rechazar puntos de código peligrosos (control, null, surrogate pairs no válidos)
      if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    }
  );
  // Eliminar etiquetas HTML (incluyendo scripts, style, etc.)
  out = out.replace(/<[^>]*>/g, "");
  // Colapsar espacios en blanco
  out = out.replace(/\s+/g, " ").trim();
  return out.slice(0, maxLen);
}

// Esquemas permitidos por contexto
const LINK_SCHEMES   = new Set(["http", "https", "mailto"]);
const IMG_SCHEMES    = new Set(["http", "https"]);

/**
 * Valida y normaliza una URL para uso seguro en atributos HTML.
 *
 * @param {string} href     - URL a validar
 * @param {"link"|"img"}  context - "link" permite mailto; "img" solo http/https
 * @returns {string|null}   - URL canónica o null si no es segura
 */
function safeUrl(href, context = "link") {
  if (typeof href !== "string") return null;

  // 1. Normalizar: recortar espacios y decodificar entidades HTML básicas
  let url = href.trim();
  url = url
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi,  "<")
    .replace(/&gt;/gi,  ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // 2. Rechazar caracteres de control y espacios internos
  // Buscar cualquier carácter de control (\x00-\x1f, \x7f) o espacio/tab en cualquier posición
  // (el trim ya eliminó los del inicio/fin, pero pueden estar en medio)
  if (/[\x00-\x1f\x7f]/.test(url)) return null;
  // Espacio o tab en cualquier posición (incluyendo dentro del path)
  if (/[ \t]/.test(url)) return null;

  // 3. Extraer esquema de forma segura (sin usar URL() aún para evitar normalizaciones)
  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!schemeMatch) return null; // sin esquema explícito → rechazar (evita protocol-relative //...)

  const scheme = schemeMatch[1].toLowerCase();

  // 4. Allowlist de esquemas
  const allowed = context === "img" ? IMG_SCHEMES : LINK_SCHEMES;
  if (!allowed.has(scheme)) return null;

  // 5. Validar con el parser nativo
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // 6. Segunda comprobación del scheme tras normalización (defensa contra bypass de URL())
  if (!allowed.has(parsed.protocol.replace(/:$/, ""))) return null;

  // 7. Para mailto: solo permitir en links de texto, no como src de imágenes
  if (parsed.protocol === "mailto:" && context === "img") return null;

  return parsed.toString();
}

module.exports = { escapeHtml, stripHtml, safeUrl };

"use strict";

const fs   = require("node:fs/promises");
const path = require("node:path");
const { escapeHtml } = require("./sanitize.js");

const PARTIALS_DIR = path.join(__dirname, "../public/partials");

async function loadPartial(name) {
  return fs.readFile(path.join(PARTIALS_DIR, `${name}.html`), "utf8");
}

async function resolvePartials(template) {
  const PARTIAL_RE = /\{\{>([a-z0-9_-]+)\}\}/gi;
  const matches    = [...template.matchAll(PARTIAL_RE)];
  if (matches.length === 0) return template;

  const contents = await Promise.all(
    matches.map((m) => loadPartial(m[1]).catch(() => ""))
  );

  let i = 0;
  return template.replace(PARTIAL_RE, () => contents[i++]);
}

/**
 * Renders a template string with data:
 *   {{>name}}     → content of public/partials/name.html (resolved first, up to 5 passes)
 *   {{key}}       → escapeHtml(data[key])
 *   {{__body__}}  → data.__body__ inserted raw (trusted markdown AST output only)
 */
async function renderTemplate(template, data = {}) {
  let result = template;
  for (let pass = 0; pass < 5; pass++) {
    if (!/\{\{>/.test(result)) break;
    result = await resolvePartials(result);
  }

  result = result.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const val = data[key];
    if (val == null) return "";
    if (key === "__body__") return String(val); // raw — only for trusted AST output
    return escapeHtml(String(val));
  });

  return result;
}

async function renderFile(filePath, data = {}) {
  const template = await fs.readFile(filePath, "utf8");
  return renderTemplate(template, data);
}

module.exports = { renderTemplate, renderFile };

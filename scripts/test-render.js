#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { renderTemplate } = require(path.join(__dirname, "../server/render.js"));
const { compilePattern } = require(path.join(__dirname, "../server/router.js"));

let passed = 0;
let failed = 0;

function ok(label)           { console.log(`  ✓ ${label}`); passed++; }
function fail(label, reason) { console.error(`  ✗ ${label}\n    ${reason}`); failed++; }

async function eq(label, got, expected) {
  if (got === expected) ok(label);
  else fail(label, `expected: ${JSON.stringify(expected)}\n    got:      ${JSON.stringify(got)}`);
}

function matchParam(pattern, url, expectedParams) {
  const { re, keys } = compilePattern(pattern);
  const match = url.match(re);
  if (!match) { fail(`compilePattern("${pattern}") should match "${url}"`, "no match"); return; }
  const params = {};
  for (let i = 0; i < keys.length; i++) params[keys[i]] = match[i + 1];
  const got  = JSON.stringify(params);
  const want = JSON.stringify(expectedParams);
  if (got === want) ok(`"${pattern}" matches "${url}" → ${got}`);
  else fail(`param extraction for "${pattern}" on "${url}"`, `expected ${want}, got ${got}`);
}

function noMatch(pattern, url) {
  const { re } = compilePattern(pattern);
  if (!url.match(re)) ok(`"${pattern}" correctly rejects "${url}"`);
  else fail(`"${pattern}" should NOT match "${url}"`, "unexpectedly matched");
}

async function main() {
  // ─── renderTemplate — escaping ──────────────────────────────────────────────
  console.log("\n── renderTemplate — escape HTML en slots ──");

  const xss = '<script>alert(1)</script>';

  await eq(
    "XSS en slot → escapado",
    await renderTemplate("{{title}}", { title: xss }),
    "&lt;script&gt;alert(1)&lt;/script&gt;"
  );

  await eq(
    "Comillas y ampersand escapados",
    await renderTemplate("{{val}}", { val: '"><img src=x onerror=alert(1)>&' }),
    "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;"
  );

  await eq(
    "Slot ausente → cadena vacía",
    await renderTemplate("hello {{missing}} world", {}),
    "hello  world"
  );

  await eq(
    "Slot nulo → cadena vacía",
    await renderTemplate("{{v}}", { v: null }),
    ""
  );

  await eq(
    "Múltiples slots en mismo template",
    await renderTemplate("{{a}}-{{b}}", { a: "hola", b: "<mundo>" }),
    "hola-&lt;mundo&gt;"
  );

  await eq(
    "Valor numérico se convierte a string y escapa",
    await renderTemplate("{{n}}", { n: 42 }),
    "42"
  );

  // ─── renderTemplate — __body__ es raw ───────────────────────────────────────
  console.log("\n── renderTemplate — {{__body__}} es raw (solo AST de confianza) ──");

  await eq(
    "__body__ se inserta sin escapar (trusted AST)",
    await renderTemplate("{{__body__}}", { __body__: "<p>Hola</p>" }),
    "<p>Hola</p>"
  );

  // ─── renderTemplate — partials ──────────────────────────────────────────────
  // Los partials se cargan desde public/partials/; en este test no existen partials
  // de prueba, así que verificamos que los parciales inexistentes se reemplazan por "".
  console.log("\n── renderTemplate — partials ──");

  await eq(
    "Partial inexistente → cadena vacía (sin error)",
    await renderTemplate("A{{>nonexistent}}B", {}),
    "AB"
  );

  await eq(
    "Template sin partials pasa directamente",
    await renderTemplate("<p>{{msg}}</p>", { msg: "hola" }),
    "<p>hola</p>"
  );

  // Verifica que los partials reales (head/header/footer) se cargan correctamente
  console.log("\n── renderTemplate — partials reales ──");
  try {
    const result = await renderTemplate("{{>head}}", { pageTitle: "Test" });
    if (result.includes("<head>") && result.includes("<title>Test</title>")) {
      ok("{{>head}} carga el partial head.html con {{pageTitle}} sustituido");
    } else {
      fail("{{>head}}", `resultado inesperado: ${result.slice(0, 100)}`);
    }
  } catch (e) {
    fail("{{>head}} carga partial", e.message);
  }

  try {
    const result = await renderTemplate("{{>header}}", {});
    if (result.includes('<header') && result.includes('site-header')) {
      ok("{{>header}} carga el partial header.html");
    } else {
      fail("{{>header}}", `resultado inesperado: ${result.slice(0, 100)}`);
    }
  } catch (e) {
    fail("{{>header}} carga partial", e.message);
  }

  try {
    const result = await renderTemplate("{{>footer}}", { year: "2026" });
    if (result.includes('<footer') && result.includes("2026")) {
      ok("{{>footer}} carga el partial footer.html con {{year}} sustituido");
    } else {
      fail("{{>footer}}", `resultado inesperado: ${result.slice(0, 100)}`);
    }
  } catch (e) {
    fail("{{>footer}} carga partial", e.message);
  }

  // ─── compilePattern — coincidencia de rutas ─────────────────────────────────
  console.log("\n── compilePattern — matcheo de rutas ──");

  matchParam("/",                     "/",                       {});
  matchParam("/api/resources",        "/api/resources",          {});
  matchParam("/api/resources/:id",    "/api/resources/abc123",   { id: "abc123" });
  matchParam("/api/resources/:id",    "/api/resources/xyz-456",  { id: "xyz-456" });
  matchParam("/islas/:slug",          "/islas/tenerife",         { slug: "tenerife" });
  matchParam("/blog/:slug",           "/blog/mi-articulo",       { slug: "mi-articulo" });
  matchParam("/api/:a/:b",            "/api/foo/bar",            { a: "foo", b: "bar" });
  matchParam("/:page.html",           "/buscar.html",            { page: "buscar" });
  matchParam("/:page.html",           "/index.html",             { page: "index" });

  noMatch("/api/resources/:id",       "/api/resources");
  noMatch("/api/resources/:id",       "/api/resources/");
  noMatch("/islas/:slug",             "/islas/tenerife/extra");
  noMatch("/",                        "/api");

  // Query string no interfiere con el matcheo
  matchParam("/islas/:slug",          "/islas/gran-canaria?tab=mapa", { slug: "gran-canaria" });

  // ─── Resumen ─────────────────────────────────────────────────────────────────
  console.log(`\n── Resultado: ${passed} ok, ${failed} fallaron ──\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

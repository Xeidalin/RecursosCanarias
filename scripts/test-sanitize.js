#!/usr/bin/env node
"use strict";

const path = require("path");
const { escapeHtml, stripHtml, safeUrl } = require(path.join(__dirname, "../server/sanitize.js"));

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertNull(label, actual) {
  assert(label, actual, null);
}

function assertNotNull(label, actual) {
  const ok = actual !== null && actual !== undefined;
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: non-null`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
console.log("\n── escapeHtml ──");
assert("escapa &",   escapeHtml("a & b"),             "a &amp; b");
assert("escapa <",   escapeHtml("<script>"),           "&lt;script&gt;");
assert("escapa >",   escapeHtml("a > b"),              "a &gt; b");
assert('escapa "',   escapeHtml('say "hi"'),           "say &quot;hi&quot;");
assert("escapa '",   escapeHtml("it's"),               "it&#39;s");
assert("vacío",      escapeHtml(""),                   "");
assert("no-string",  escapeHtml(null),                 "");
assert("XSS clásico", escapeHtml('<img onerror="alert(1)">'), "&lt;img onerror=&quot;alert(1)&quot;&gt;");

// ---------------------------------------------------------------------------
// stripHtml
// ---------------------------------------------------------------------------
console.log("\n── stripHtml ──");
assert("texto plano",     stripHtml("Hola mundo"),           "Hola mundo");
assert("quita etiquetas", stripHtml("<b>Hola</b>"),          "Hola");
assert("quita script",    stripHtml("<script>x</script>"),   "x");
assert("decodifica &amp;",stripHtml("A &amp; B"),            "A & B");
// &lt;b&gt; se decodifica a <b> y luego se elimina la etiqueta: comportamiento seguro
assert("entidad &lt;b&gt; → etiqueta eliminada", stripHtml("&lt;b&gt;"), "");
assert("decodifica &#39;",stripHtml("it&#39;s"),             "it's");
assert("decodifica &#x27;",stripHtml("it&#x27;s"),           "it's");
assert("trunca a 300",    stripHtml("x".repeat(400)).length, 300);
assert("colapsa espacios",stripHtml("a   b\n\tc"),           "a b c");
assert("no-string",       stripHtml(null),                   "");
assert("script con attr", stripHtml('<script src="evil.js">alert(1)</script>'), "alert(1)");
assert("xss atributo",    stripHtml('<img onerror="alert(1)" src="x">'),        "");

// ---------------------------------------------------------------------------
// safeUrl — casos que deben devolver null
// ---------------------------------------------------------------------------
console.log("\n── safeUrl — rechazados (deben ser null) ──");
assertNull("javascript:alert(1)",             safeUrl("javascript:alert(1)"));
assertNull("JaVaScRiPt:alert(1)",             safeUrl("JaVaScRiPt:alert(1)"));
assertNull(" javascript:alert(1)",            safeUrl(" javascript:alert(1)"));  // espacio inicial
assertNull("java script:alert(1)",            safeUrl("java script:alert(1)")); // espacio en scheme
assertNull("data:text/html,...",              safeUrl("data:text/html,<script>alert(1)</script>"));
assertNull("vbscript:...",                    safeUrl("vbscript:msgbox(1)"));
assertNull("//evil.com/path (protocol-rel)", safeUrl("//evil.com/path"));
assertNull("espacio en path",                safeUrl("http://example.com/ path"));
assertNull("tab en URL",                     safeUrl("http://example.com/\tpath"));
assertNull("null byte",                      safeUrl("http://example.com/\x00path"));
assertNull("newline en URL",                 safeUrl("http://example.com/\npath"));
assertNull("carriage return",                safeUrl("http://example.com/\rpath"));
assertNull("sin esquema",                    safeUrl("example.com/path"));
assertNull("esquema vacío",                  safeUrl(":alert(1)"));
assertNull("ftp:// (no en allowlist)",       safeUrl("ftp://files.example.com/file.pdf"));
assertNull("mailto en img",                  safeUrl("mailto:a@b.com", "img"));
assertNull("string vacío",                   safeUrl(""));
assertNull("no string",                      safeUrl(null));
assertNull("solo espacios",                  safeUrl("   "));

// Asegurar que &lt; no se filtra mediante entidades para bypassear scheme check
assertNull("javascript via &lt; encode",     safeUrl("javascript&colon;alert(1)"));

// ---------------------------------------------------------------------------
// safeUrl — casos válidos (deben devolver algo no-null)
// ---------------------------------------------------------------------------
console.log("\n── safeUrl — aceptados (deben ser no-null) ──");
assertNotNull("https URL normal",     safeUrl("https://example.com/path?q=1"));
assertNotNull("http URL normal",      safeUrl("http://example.com/image.png"));
assertNotNull("mailto en link",       safeUrl("mailto:contact@example.com", "link"));
assertNotNull("https con puerto",     safeUrl("https://example.com:8080/path"));
assertNotNull("URL con hash",         safeUrl("https://example.com/page#section"));
assertNotNull("URL con unicode (IDN)",safeUrl("https://ejemplo.es/ruta"));

// Normalización: URL con &amp; en query string
const normalized = safeUrl("https://example.com/?a=1&amp;b=2");
assertNotNull("URL con &amp; en query", normalized);
// El & debe estar decodificado en la URL canónica
assert("&amp; se decodifica en query", normalized?.includes("&amp;"), false);

// ---------------------------------------------------------------------------
// safeUrl — contexto img
// ---------------------------------------------------------------------------
console.log("\n── safeUrl — contexto img ──");
assertNotNull("https img",  safeUrl("https://cdn.example.com/img.png", "img"));
assertNotNull("http img",   safeUrl("http://cdn.example.com/img.png",  "img"));
assertNull("data img",      safeUrl("data:image/png;base64,abc",       "img"));

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------
console.log(`\n── Resultado: ${passed} ok, ${failed} fallaron ──\n`);
if (failed > 0) process.exit(1);

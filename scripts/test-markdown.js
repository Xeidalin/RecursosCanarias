#!/usr/bin/env node
"use strict";

const { render, renderInline } = require("../server/markdown.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "assertion failed");
}

function assertContains(html, needle, msg) {
  assert(html.includes(needle), `Expected to contain: ${needle}\n    Got: ${html}\n    ${msg || ""}`);
}

function assertNotContains(html, needle, msg) {
  assert(!html.includes(needle), `Expected NOT to contain: ${needle}\n    Got: ${html}\n    ${msg || ""}`);
}

console.log("\n── renderInline — inline elements ─────────────────────────────────────────");

test("bold **text**", () => {
  const out = renderInline("Hello **world**");
  assertContains(out, "<strong>world</strong>");
});

test("italic *text*", () => {
  const out = renderInline("Hello *world*");
  assertContains(out, "<em>world</em>");
});

test("inline `code`", () => {
  const out = renderInline("Run `npm install` now");
  assertContains(out, "<code>npm install</code>");
});

test("link with valid URL", () => {
  const out = renderInline("[click](https://example.com)");
  // safeUrl canonicalizes via new URL() which may add trailing slash
  assert(out.includes('href="https://example.com"') || out.includes('href="https://example.com/"'), `href not found in: ${out}`);
  assertContains(out, ">click</a>");
});

test("image with valid URL", () => {
  const out = renderInline("![alt](https://example.com/img.png)");
  assertContains(out, 'src="https://example.com/img.png"');
  assertContains(out, 'alt="alt"');
});

console.log("\n── renderInline — XSS payload rejection ───────────────────────────────────");

test("javascript: link → text only", () => {
  const out = renderInline("[click](javascript:alert(1))");
  assertNotContains(out, "javascript:");
  assertNotContains(out, "<a");
  assertContains(out, "click");
});

test("JaVaScRiPt: mixed case → rejected", () => {
  const out = renderInline("[x](JaVaScRiPt:alert(1))");
  assertNotContains(out, "JaVaScRiPt:");
});

test("data: URL in link → rejected", () => {
  const out = renderInline("[x](data:text/html,<h1>XSS</h1>)");
  assertNotContains(out, "data:");
});

test("// protocol-relative URL → rejected", () => {
  const out = renderInline("[x](//evil.com/hack)");
  assertNotContains(out, "<a");
});

test("<script> tag in inline text → escaped", () => {
  const out = renderInline("Hello <script>alert(1)</script>");
  assertNotContains(out, "<script>");
  assertContains(out, "&lt;script&gt;");
});

test("onerror attribute → tag escaped, not executable", () => {
  const out = renderInline('<img onerror=x src="x">');
  // The whole tag must be HTML-escaped (no literal < tags that would execute)
  assertNotContains(out, "<img");
  assertContains(out, "&lt;img");
});

test("& in text → &amp;", () => {
  const out = renderInline("Bread & butter");
  assertContains(out, "Bread &amp; butter");
});

test("javascript: image src → not rendered", () => {
  const out = renderInline("![x](javascript:alert(1))");
  assertNotContains(out, "javascript:");
  assertNotContains(out, "<img");
});

console.log("\n── render — block elements ─────────────────────────────────────────────────");

test("h1 heading", () => {
  const out = render("# Título");
  assertContains(out, "<h1>Título</h1>");
});

test("h2 heading", () => {
  const out = render("## Sección");
  assertContains(out, "<h2>Sección</h2>");
});

test("h3 heading", () => {
  const out = render("### Subsección");
  assertContains(out, "<h3>Subsección</h3>");
});

test("paragraph", () => {
  const out = render("Hello world");
  assertContains(out, "<p>Hello world</p>");
});

test("unordered list", () => {
  const out = render("- item A\n- item B");
  assertContains(out, "<ul>");
  assertContains(out, "<li>item A</li>");
  assertContains(out, "<li>item B</li>");
});

test("ordered list", () => {
  const out = render("1. first\n2. second");
  assertContains(out, "<ol>");
  assertContains(out, "<li>first</li>");
});

test("blockquote", () => {
  const out = render("> quoted text");
  assertContains(out, "<blockquote>");
  assertContains(out, "quoted text");
});

test("fenced code block", () => {
  const out = render("```\nconsole.log(1);\n```");
  assertContains(out, "<pre><code>");
  assertContains(out, "console.log(1);");
});

test("horizontal rule ---", () => {
  const out = render("---");
  assertContains(out, "<hr>");
});

console.log("\n── render — XSS in blocks ───────────────────────────────────────────────────");

test("<script> in paragraph → escaped", () => {
  const out = render("<script>alert(1)</script>");
  assertNotContains(out, "<script>");
  assertContains(out, "&lt;script&gt;");
});

test("inline javascript: link in paragraph → dropped", () => {
  const out = render("See [this](javascript:alert(1)) page");
  assertNotContains(out, "javascript:");
  assertNotContains(out, "<a");
  assertContains(out, "this");
});

test("h4+ not rendered as heading (beyond allowlist)", () => {
  const out = render("#### Level 4");
  assertNotContains(out, "<h4>");
});

test("inline onclick not passed through", () => {
  const out = render('<a onclick="evil()">click</a>');
  assertNotContains(out, "onclick");
  assertContains(out, "&lt;a");
});

console.log("\n── render — fenced code XSS ────────────────────────────────────────────────");

test("<script> inside code block → escaped, not executed", () => {
  const out = render("```\n<script>alert(1)</script>\n```");
  assertContains(out, "&lt;script&gt;");
  assertNotContains(out, "<script>");
});

console.log(`\n── Resultado: ${passed} ok, ${failed} fallaron ──\n`);
if (failed > 0) process.exit(1);

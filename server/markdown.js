"use strict";

/**
 * Safe markdown → HTML renderer.
 *
 * Allowlist: paragraphs, h1-h3, blockquote, ul/ol/li, hr,
 *            strong, em, code (inline), pre+code (fenced), img, a, br.
 *
 * Security:
 * - No raw HTML tags are passed through; `<` not part of markdown syntax
 *   is treated as plain text and escaped.
 * - All URLs go through safeUrl() — javascript:, data:, etc. are dropped.
 * - Attribute values are HTML-escaped.
 */

const { escapeHtml, safeUrl } = require("./sanitize.js");

// ─── Inline renderer ─────────────────────────────────────────────────────────

function renderInline(text) {
  let out = "";
  let i   = 0;

  while (i < text.length) {
    // Escaped character \x
    if (text[i] === "\\" && i + 1 < text.length) {
      out += escapeHtml(text[i + 1]);
      i   += 2;
      continue;
    }

    // `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        out += `<code>${escapeHtml(text.slice(i + 1, end))}</code>`;
        i    = end + 1;
        continue;
      }
    }

    // **bold** or __bold__
    const boldMark = text.startsWith("**", i) ? "**" : text.startsWith("__", i) ? "__" : null;
    if (boldMark) {
      const end = text.indexOf(boldMark, i + 2);
      if (end !== -1) {
        out += `<strong>${renderInline(text.slice(i + 2, end))}</strong>`;
        i    = end + 2;
        continue;
      }
    }

    // *em* or _em_
    if ((text[i] === "*" || text[i] === "_") && text[i - 1] !== text[i]) {
      const mark = text[i];
      const end  = text.indexOf(mark, i + 1);
      if (end !== -1 && text[end - 1] !== "\\") {
        out += `<em>${renderInline(text.slice(i + 1, end))}</em>`;
        i    = end + 1;
        continue;
      }
    }

    // ![alt](url) or ![alt](url "title")
    if (text[i] === "!" && text[i + 1] === "[") {
      const closeAlt = text.indexOf("]", i + 2);
      if (closeAlt !== -1 && text[closeAlt + 1] === "(") {
        const closeParen = text.indexOf(")", closeAlt + 2);
        if (closeParen !== -1) {
          const alt     = text.slice(i + 2, closeAlt);
          const rawHref = text.slice(closeAlt + 2, closeParen).split(/\s+/)[0];
          const href    = safeUrl(rawHref, "img");
          if (href) {
            out += `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" loading="lazy">`;
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // [text](url) or [text](url "title")
    if (text[i] === "[") {
      const closeText  = text.indexOf("]", i + 1);
      if (closeText !== -1 && text[closeText + 1] === "(") {
        const closeParen = text.indexOf(")", closeText + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeText);
          const rawHref  = text.slice(closeText + 2, closeParen).split(/\s+/)[0];
          const href     = safeUrl(rawHref);
          if (href) {
            out += `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${renderInline(linkText)}</a>`;
          } else {
            out += escapeHtml(linkText);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Hard line break (two trailing spaces)
    if (text[i] === " " && text[i + 1] === " " && (text[i + 2] === "\n" || i + 2 >= text.length)) {
      out += "<br>";
      i   += 2;
      continue;
    }

    // Default — escape HTML entity
    out += escapeHtml(text[i]);
    i++;
  }

  return out;
}

// ─── Block renderer ───────────────────────────────────────────────────────────

function render(markdown) {
  if (!markdown) return "";

  // Normalize line endings
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out   = [];
  let   i     = 0;

  function peek(offset = 0) { return lines[i + offset]; }
  function consume()        { return lines[i++]; }

  while (i < lines.length) {
    const line = peek();

    // Blank line
    if (/^\s*$/.test(line)) { consume(); continue; }

    // Fenced code block ```lang ... ```
    if (/^```/.test(line)) {
      consume(); // opening fence
      const codeLines = [];
      while (i < lines.length && !/^```/.test(peek())) {
        codeLines.push(escapeHtml(consume()));
      }
      if (i < lines.length) consume(); // closing fence
      out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // ATX headings # ## ###
    const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      out.push(`<h${level}>${renderInline(hMatch[2].trim())}</h${level}>`);
      consume();
      continue;
    }

    // Setext headings (underline === or ---)
    if (i + 1 < lines.length) {
      const next = peek(1);
      if (/^=+$/.test(next.trim()) && next.trim().length >= 2) {
        out.push(`<h1>${renderInline(line.trim())}</h1>`);
        consume(); consume();
        continue;
      }
      if (/^-+$/.test(next.trim()) && next.trim().length >= 2) {
        out.push(`<h2>${renderInline(line.trim())}</h2>`);
        consume(); consume();
        continue;
      }
    }

    // Horizontal rule --- or ***
    if (/^(\-\-\-+|\*\*\*+|___+)\s*$/.test(line.trim())) {
      out.push("<hr>");
      consume();
      continue;
    }

    // Blockquote >
    if (/^> /.test(line)) {
      const bqLines = [];
      while (i < lines.length && /^> ?/.test(peek())) {
        bqLines.push(consume().replace(/^> ?/, ""));
      }
      out.push(`<blockquote>${render(bqLines.join("\n"))}</blockquote>`);
      continue;
    }

    // Unordered list - * +
    if (/^[-*+] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+] /.test(peek())) {
        items.push(`<li>${renderInline(consume().slice(2).trim())}</li>`);
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list 1. 2. etc.
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(peek())) {
        items.push(`<li>${renderInline(consume().replace(/^\d+\. /, "").trim())}</li>`);
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Paragraph — collect until blank line
    const paraLines = [];
    while (i < lines.length && !/^\s*$/.test(peek()) &&
           !/^(#{1,3}|> |[-*+] |\d+\. |```|-{3,}|\*{3,})/.test(peek())) {
      paraLines.push(consume().trim());
    }
    if (paraLines.length) {
      out.push(`<p>${renderInline(paraLines.join(" "))}</p>`);
    }
  }

  return out.join("\n");
}

module.exports = { render, renderInline };

"use strict";

function send(res, status, body, type = "text/html; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

async function readBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size     = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error("Cuerpo de la petición demasiado grande");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("JSON inválido");
    err.status = 400;
    throw err;
  }
}

function safeDecodeUrl(url) {
  try {
    return decodeURIComponent(url.split("?")[0]);
  } catch {
    return null;
  }
}

module.exports = { send, sendJson, readBody, safeDecodeUrl };

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_FILE = path.join(ROOT, "data", "resources.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readResources() {
  const raw = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeResources(resources) {
  await fs.writeFile(DATA_FILE, `${JSON.stringify(resources, null, 2)}\n`, "utf8");
}

function normalizeResource(input) {
  const title = String(input.title || "").trim();
  const type = String(input.type || "").trim();
  const stage = String(input.stage || "").trim();
  const level = String(input.level || "").trim();
  const subject = String(input.subject || "").trim();

  if (!title || !type || !stage || !level || !subject) {
    return { error: "Faltan campos obligatorios: titulo, tipo, etapa, nivel o materia." };
  }

  return {
    id: randomUUID(),
    title,
    type,
    stage,
    level,
    subject,
    island: String(input.island || "Canarias").trim(),
    license: String(input.license || "Uso educativo").trim(),
    description: String(input.description || "").trim(),
    imageUrl: String(input.imageUrl || "").trim(),
    fileUrl: String(input.fileUrl || "").trim(),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : String(input.tags || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
    createdAt: new Date().toISOString()
  };
}

async function handleApi(req, res) {
  if (req.url === "/api/resources" && req.method === "GET") {
    const resources = await readResources();
    sendJson(res, 200, resources);
    return true;
  }

  if (req.url === "/api/resources" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const resource = normalizeResource(body);

      if (resource.error) {
        sendJson(res, 400, { error: resource.error });
        return true;
      }

      const resources = await readResources();
      resources.unshift(resource);
      await writeResources(resources);
      sendJson(res, 201, resource);
    } catch (error) {
      sendJson(res, 400, { error: "No se pudo guardar el recurso." });
    }
    return true;
  }

  return false;
}

async function serveStatic(req, res) {
  const cleanUrl = decodeURIComponent(req.url.split("?")[0]);
  const route = cleanUrl === "/" ? "/index.html" : cleanUrl;
  const requestedPath = path.normalize(path.join(PUBLIC_DIR, route));

  if (!requestedPath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Acceso no permitido", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await fs.readFile(requestedPath);
    const ext = path.extname(requestedPath).toLowerCase();
    send(res, 200, file, mimeTypes[ext] || "application/octet-stream");
  } catch {
    const fallback = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
    send(res, 404, fallback, "text/html; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      const handled = await handleApi(req, res);
      if (!handled) sendJson(res, 404, { error: "Ruta API no encontrada." });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Error interno del servidor." });
  }
});

server.listen(PORT, () => {
  console.log(`Recursos Canarias disponible en http://localhost:${PORT}`);
});

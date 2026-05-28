const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env.local") });
require("dotenv").config();

const http = require("node:http");
const fs   = require("node:fs/promises");

const { ConvexHttpClient } = require("convex/browser");
const { api }              = require("./convex/_generated/api-node.js");
const { dispatch }         = require("./server/router.js");
const { send, safeDecodeUrl } = require("./server/http.js");

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("Falta CONVEX_URL en .env.local. Ejecuta `npx convex dev` para vincular el proyecto.");
  process.exit(1);
}

const convex = new ConvexHttpClient(CONVEX_URL);

// Wire up routes (side-effect imports register routes in the router)
const resourcesRoute = require("./server/routes/api-resources.js");
resourcesRoute.init(convex, api);

const adminRoute = require("./server/routes/api-admin.js");
adminRoute.init(convex, api);

const blogRoute = require("./server/routes/api-blog.js");
blogRoute.init(convex, api);

const pagesRoute = require("./server/routes/pages.js");
pagesRoute.init(convex, api);

// MIME types for static assets (non-HTML only; HTML served via SSR router)
const MIME = {
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
};

async function serveStatic(req, res) {
  const cleanUrl = safeDecodeUrl(req.url);
  if (cleanUrl === null) {
    send(res, 400, "URL inválida", "text/plain; charset=utf-8");
    return;
  }
  const ext      = path.extname(cleanUrl).toLowerCase();
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanUrl));

  // Path traversal guard
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    send(res, 403, "Acceso no permitido", "text/plain; charset=utf-8");
    return;
  }

  // Only serve known static asset types — HTML pages go through the SSR router
  const mime = MIME[ext];
  if (!mime) {
    send(res, 404, "No encontrado", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    send(res, 200, file, mime);
  } catch {
    send(res, 404, "No encontrado", "text/plain; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const handled = await dispatch(req, res);
    if (!handled) await serveStatic(req, res);
  } catch (err) {
    console.error(err);
    const status = err.status || 500;
    send(res, status, JSON.stringify({ error: err.message || "Error interno" }),
      "application/json; charset=utf-8");
  }
});

server.listen(PORT, () => {
  console.log(`Recursos Canarias disponible en http://localhost:${PORT}`);
  console.log(`Convex: ${CONVEX_URL}`);
});

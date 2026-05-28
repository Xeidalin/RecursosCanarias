#!/usr/bin/env node
"use strict";

/**
 * Populates the Convex database with resources from data/resources.json (v2 shape)
 * and syncs the junction tables (resourceIslands, resourceTopics, resourceLevels).
 *
 * Safe to run multiple times: no-ops if resources table already has data.
 * To re-seed from scratch, clear the resources table first from the Convex dashboard.
 *
 * Usage: npm run seed
 */

const path = require("node:path");
const fs   = require("node:fs/promises");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
require("dotenv").config();

const { ConvexHttpClient } = require("convex/browser");
const { api }              = require("../convex/_generated/api-node.js");

async function main() {
  const url = process.env.CONVEX_URL;
  if (!url) {
    console.error("Falta CONVEX_URL en .env.local. Ejecuta `npx convex dev` para obtenerlo.");
    process.exit(1);
  }

  const dataFile = path.join(__dirname, "..", "data", "resources.json");
  let items;
  try {
    items = JSON.parse(await fs.readFile(dataFile, "utf8"));
  } catch {
    console.error(`No se pudo leer ${dataFile}. Ejecuta primero: node scripts/migrate-resources.js`);
    process.exit(1);
  }

  // Validate the shape expected by seedV2
  const required = ["slug", "title", "kind", "isExternal", "islands", "topics", "levels"];
  for (const [i, item] of items.entries()) {
    const missing = required.filter((k) => item[k] === undefined);
    if (missing.length) {
      console.error(`Ítem ${i} (slug="${item.slug}"): faltan campos: ${missing.join(", ")}`);
      process.exit(1);
    }
  }

  console.log(`Cargando ${items.length} recursos desde ${dataFile}…`);

  const convex  = new ConvexHttpClient(url);
  const result  = await convex.mutation(api.resources.seedV2, { items });

  if (result.skipped > 0) {
    console.log(`Ya había ${result.skipped} recursos. No se insertó nada (usa el dashboard Convex para limpiar y re-seed).`);
  } else {
    console.log(`✓ Insertados: ${result.inserted} recursos + junctions sincronizadas.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

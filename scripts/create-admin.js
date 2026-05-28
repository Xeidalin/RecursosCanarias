#!/usr/bin/env node
"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { ConvexHttpClient } = require("convex/browser");
const { generateSalt, hashPassword } = require("../server/auth.js");

async function main() {
  const [, , username, password] = process.argv;

  if (!username || !password) {
    console.error("Uso: node scripts/create-admin.js <username> <password>");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("Falta CONVEX_URL en .env.local");
    process.exit(1);
  }

  // Lazy require to avoid loading api before env is set
  const { api } = require("../convex/_generated/api");
  const convex  = new ConvexHttpClient(convexUrl);

  try {
    console.log("Generando hash de contraseña (scrypt)…");
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    const id = await convex.mutation(api.admins.create, {
      username,
      passwordHash: hash,
      salt,
    });

    console.log(`✓ Admin '${username}' creado con id ${id}`);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();

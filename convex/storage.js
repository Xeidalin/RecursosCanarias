import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function requireDeployKey(deployKey) {
  const expected = process.env.CONVEX_DEPLOY_KEY;
  if (!expected || deployKey !== expected) {
    throw new Error("No autorizado");
  }
}

// Genera una URL de subida POST-only de Convex Storage.
// Llamada desde el admin via /api/admin/resources/upload-url o /api/admin/blog/upload-cover.
export const generateUploadUrl = mutation({
  args: { deployKey: v.string() },
  handler: async (ctx, { deployKey }) => {
    requireDeployKey(deployKey);
    return await ctx.storage.generateUploadUrl();
  },
});

// Traduce un storageId devuelto por la subida en URL pública servida por Convex.
// Devuelve null si el storageId no existe.
export const getStorageUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});

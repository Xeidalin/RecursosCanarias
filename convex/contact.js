import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_TYPES = new Set(["colaboracion", "sugerencia", "error", "otro"]);

function requireDeployKey(deployKey) {
  const expected = process.env.CONVEX_DEPLOY_KEY;
  if (!expected || deployKey !== expected) {
    throw new Error("No autorizado");
  }
}

function toApi(doc) {
  return {
    _id:       doc._id,
    name:      doc.name,
    email:     doc.email,
    message:   doc.message,
    type:      doc.type,
    createdAt: doc.createdAt,
    handled:   doc.handled,
  };
}

export const submit = mutation({
  args: {
    name:      v.string(),
    email:     v.string(),
    message:   v.string(),
    type:      v.string(),
    deployKey: v.string(),
  },
  handler: async (ctx, { name, email, message, type, deployKey }) => {
    requireDeployKey(deployKey);

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 200) {
      throw new Error("El nombre es obligatorio (máx. 200 caracteres).");
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      throw new Error("Email inválido.");
    }

    if (!VALID_TYPES.has(type)) {
      throw new Error("Motivo inválido.");
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 10) {
      throw new Error("El mensaje debe tener al menos 10 caracteres.");
    }
    if (trimmedMessage.length > 5000) {
      throw new Error("El mensaje es demasiado largo (máx. 5000 caracteres).");
    }

    await ctx.db.insert("contactMessages", {
      name:      trimmedName,
      email:     trimmedEmail.toLowerCase(),
      message:   trimmedMessage,
      type,
      createdAt: new Date().toISOString(),
      handled:   false,
    });
    return { ok: true };
  },
});

export const listAdmin = query({
  args: {
    paginationOpts: paginationOptsValidator,
    deployKey:      v.string(),
  },
  handler: async (ctx, { paginationOpts, deployKey }) => {
    requireDeployKey(deployKey);

    // Dos páginas: primero pendientes, luego atendidos.
    // Usamos el índice by_handled_created con order("asc") que da:
    // handled=false (más antiguo primero), handled=true (más antiguo primero).
    const result = await ctx.db.query("contactMessages")
      .withIndex("by_handled_created")
      .order("asc")
      .paginate(paginationOpts);

    return {
      items: result.page.map(toApi),
      continueCursor: result.continueCursor,
      isDone:         result.isDone,
    };
  },
});

export const markHandled = mutation({
  args: {
    id:        v.id("contactMessages"),
    deployKey: v.string(),
  },
  handler: async (ctx, { id, deployKey }) => {
    requireDeployKey(deployKey);
    await ctx.db.patch(id, { handled: true });
    return { ok: true };
  },
});

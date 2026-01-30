import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server.js";

export const findByPhone = internalQuery({
  args: {
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("talent")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
  },
});

export const upsert = internalMutation({
  args: {
    phone: v.string(),
    fullName: v.optional(v.string()),
    role: v.optional(v.string()),
    location: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    notes: v.optional(v.string()),
    scoutPhone: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("talent")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();

    if (existing) {
      const patch: Record<string, unknown> = { updatedAt: now };
      let updated = false;

      const fields = ["fullName", "role", "location", "linkedin", "notes", "scoutPhone"] as const;
      for (const key of fields) {
        const value = args[key];
        if (value !== undefined && value !== (existing as Record<string, unknown>)[key]) {
          patch[key] = value;
          updated = true;
        }
      }

      patch.status = updated ? "updated" : existing.status;
      await ctx.db.patch(existing._id, patch);
      return { id: existing._id, status: updated ? "updated" : "ok" };
    }

    const id = await ctx.db.insert("talent", {
      phone: args.phone,
      fullName: args.fullName,
      role: args.role,
      location: args.location,
      linkedin: args.linkedin,
      notes: args.notes,
      scoutPhone: args.scoutPhone,
      status: "ok",
      createdAt: now,
      updatedAt: now,
    });

    return { id, status: "ok" };
  },
});

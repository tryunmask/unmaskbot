import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server.js";

export const getById = internalQuery({
  args: {
    id: v.id("introRequests"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = internalMutation({
  args: {
    talentPhone: v.string(),
    companyId: v.optional(v.string()),
    companyName: v.optional(v.string()),
    reason: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("introRequests", {
      talentPhone: args.talentPhone,
      companyId: args.companyId,
      companyName: args.companyName,
      reason: args.reason,
      notes: args.notes,
      status: "requested",
      createdAt: now,
      updatedAt: now,
    });
    return { id, status: "requested" };
  },
});

export const accept = internalMutation({
  args: {
    id: v.id("introRequests"),
    notes: v.optional(v.string()),
    companyPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) return { ok: false };

    await ctx.db.patch(args.id, {
      status: "accepted",
      notes: args.notes ?? record.notes,
      companyPhone: args.companyPhone ?? record.companyPhone,
      updatedAt: Date.now(),
    });
    return { ok: true, status: "accepted" };
  },
});

export const decline = internalMutation({
  args: {
    id: v.id("introRequests"),
    reason: v.string(),
    companyPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) return { ok: false };

    await ctx.db.patch(args.id, {
      status: "declined",
      declineReason: args.reason,
      companyPhone: args.companyPhone ?? record.companyPhone,
      updatedAt: Date.now(),
    });
    return { ok: true, status: "declined" };
  },
});

import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server.js";

export const enqueue = internalMutation({
  args: {
    toPhone: v.string(),
    message: v.string(),
    agentId: v.optional(v.string()),
    channel: v.optional(v.string()),
    accountId: v.optional(v.string()),
    addToAllowlist: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("outboundMessages", {
      toPhone: args.toPhone,
      message: args.message,
      agentId: args.agentId,
      channel: args.channel,
      accountId: args.accountId,
      addToAllowlist: args.addToAllowlist,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const claimPending = internalMutation({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit)));
    const pending = await ctx.db
      .query("outboundMessages")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
      .collect();
    const sorted = pending.sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
    const now = Date.now();
    const claimed = [];
    for (const record of sorted) {
      await ctx.db.patch(record._id, {
        status: "processing",
        attempts: (record.attempts ?? 0) + 1,
        updatedAt: now,
      });
      claimed.push({
        id: record._id,
        toPhone: record.toPhone,
        message: record.message,
        agentId: record.agentId,
        channel: record.channel,
        accountId: record.accountId,
        addToAllowlist: record.addToAllowlist,
        attempts: (record.attempts ?? 0) + 1,
      });
    }
    return claimed;
  },
});

export const markStatus = internalMutation({
  args: {
    id: v.id("outboundMessages"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) return { ok: false };

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: args.status,
      lastError: args.status === "failed" ? args.error : undefined,
      sentAt: args.status === "sent" ? now : record.sentAt,
      updatedAt: now,
    });
    return { ok: true };
  },
});

export const getById = internalQuery({
  args: {
    id: v.id("outboundMessages"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

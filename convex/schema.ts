import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scouts: defineTable({
    phone: v.string(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_phone", ["phone"]),
  referrals: defineTable({
    phone: v.string(),
    name: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    notes: v.optional(v.string()),
    scoutPhone: v.optional(v.string()),
    source: v.optional(v.string()),
    status: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_phone_scout", ["phone", "scoutPhone"]),
  talent: defineTable({
    phone: v.string(),
    fullName: v.optional(v.string()),
    role: v.optional(v.string()),
    location: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    notes: v.optional(v.string()),
    scoutPhone: v.optional(v.string()),
    status: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_phone", ["phone"]),
  companies: defineTable({
    phone: v.string(),
    name: v.optional(v.string()),
    nameLower: v.optional(v.string()),
    domain: v.optional(v.string()),
    website: v.optional(v.string()),
    summary: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_phone", ["phone"])
    .index("by_nameLower", ["nameLower"]),
  introRequests: defineTable({
    talentPhone: v.string(),
    companyId: v.optional(v.string()),
    companyName: v.optional(v.string()),
    reason: v.string(),
    notes: v.optional(v.string()),
    status: v.string(),
    companyPhone: v.optional(v.string()),
    declineReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_talentPhone", ["talentPhone"])
    .index("by_companyPhone", ["companyPhone"]),
  outboundMessages: defineTable({
    toPhone: v.string(),
    message: v.string(),
    agentId: v.optional(v.string()),
    channel: v.optional(v.string()),
    accountId: v.optional(v.string()),
    addToAllowlist: v.optional(v.boolean()),
    status: v.string(),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    sentAt: v.optional(v.number()),
  }).index("by_status_createdAt", ["status", "createdAt"]),
});

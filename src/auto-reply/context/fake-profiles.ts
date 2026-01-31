import type {
  UnmaskCompanyProfile,
  UnmaskContextActorType,
  UnmaskContextBundle,
  UnmaskScoutProfile,
  UnmaskTalentProfile,
} from "./types.js";

const DEFAULT_PHONE = "+15555550123";

const FAKE_TALENT: UnmaskTalentProfile = {
  phone: DEFAULT_PHONE,
  fullName: "Alex Rivera",
  role: "Product Designer",
  location: "London",
  linkedin: "https://linkedin.com/in/alexrivera",
  notes: "Open to design roles at early-stage startups.",
  status: "ok",
};

const FAKE_COMPANY: UnmaskCompanyProfile = {
  phone: DEFAULT_PHONE,
  name: "Northwind Labs",
  domain: "northwind.example",
  website: "https://northwind.example",
  summary: "Building workflow automation for distributed teams.",
  notes: "Hiring for product + design.",
  status: "ok",
};

const FAKE_SCOUT: UnmaskScoutProfile = {
  phone: DEFAULT_PHONE,
  name: "Jordan Lee",
};

function withPhone<T extends { phone: string }>(profile: T, phone?: string): T {
  if (phone && phone.trim()) return { ...profile, phone: phone.trim() };
  return profile;
}

export function buildFakeContextBundle(params: {
  actorType: UnmaskContextActorType;
  actorPhone?: string;
}): UnmaskContextBundle {
  const actorPhone = params.actorPhone?.trim() || DEFAULT_PHONE;
  if (params.actorType === "company") {
    return {
      actorType: "company",
      actorPhone,
      company: withPhone(FAKE_COMPANY, actorPhone),
      source: "fake",
    };
  }
  if (params.actorType === "scout") {
    return {
      actorType: "scout",
      actorPhone,
      scout: withPhone(FAKE_SCOUT, actorPhone),
      source: "fake",
    };
  }
  if (params.actorType === "talent") {
    return {
      actorType: "talent",
      actorPhone,
      talent: withPhone(FAKE_TALENT, actorPhone),
      source: "fake",
    };
  }
  return {
    actorType: "unknown",
    actorPhone,
    source: "fake",
  };
}

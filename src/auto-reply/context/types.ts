export type UnmaskContextSource = "convex" | "fake" | "none";

export type UnmaskContextActorType = "talent" | "company" | "scout" | "unknown";

export type UnmaskTalentProfile = {
  phone: string;
  fullName?: string;
  role?: string;
  location?: string;
  linkedin?: string;
  notes?: string;
  status?: string;
};

export type UnmaskCompanyProfile = {
  phone: string;
  name?: string;
  domain?: string;
  website?: string;
  summary?: string;
  notes?: string;
  status?: string;
};

export type UnmaskScoutProfile = {
  phone: string;
  name?: string;
};

export type UnmaskIntroSummary = {
  id: string;
  talentPhone: string;
  companyName?: string;
  reason?: string;
  notes?: string;
  status?: string;
  companyPhone?: string;
};

export type UnmaskContextBundle = {
  actorType: UnmaskContextActorType;
  actorPhone?: string;
  talent?: UnmaskTalentProfile;
  company?: UnmaskCompanyProfile;
  scout?: UnmaskScoutProfile;
  intro?: UnmaskIntroSummary;
  source: UnmaskContextSource;
  summary?: string;
};

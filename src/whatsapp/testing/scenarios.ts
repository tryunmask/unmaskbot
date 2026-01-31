export type ScenarioRole = "persona" | "scout" | "talent" | "company";

export type ScenarioStep = {
  id: string;
  from: ScenarioRole;
  to: ScenarioRole;
  prompt: string;
};

export type Scenario = {
  id: string;
  label: string;
  description: string;
  steps: ScenarioStep[];
};

const GOLDEN_PATH: Scenario = {
  id: "golden-path",
  label: "Persona intro loop (Scout → Talent → Company)",
  description: "Persona accepts Scout, Talent requests intro, Company confirms, persona approves.",
  steps: [
    {
      id: "persona-accepts-scout",
      from: "persona",
      to: "scout",
      prompt:
        "You are acting as the persona. Accept the scout request and share your contact details: {{persona_contact}}. Keep it short and friendly.",
    },
    {
      id: "talent-contacts-persona",
      from: "talent",
      to: "persona",
      prompt:
        'You are the talent agent. The persona just wrote: "{{last_persona}}". Reach out to the persona and ask for a warm intro.',
    },
    {
      id: "persona-requests-intro",
      from: "persona",
      to: "talent",
      prompt:
        'You are the persona. Talent wrote: "{{last_talent}}". Reply confirming you want the intro and include your contact details: {{persona_contact}}.',
    },
    {
      id: "company-confirms-intro",
      from: "company",
      to: "persona",
      prompt:
        'You are the company agent. The persona said: "{{last_persona}}". Confirm the intro request and ask for approval to proceed.',
    },
    {
      id: "persona-approves",
      from: "persona",
      to: "company",
      prompt:
        'You are the persona. Company wrote: "{{last_company}}". Approve the intro and confirm your preferred contact details: {{persona_contact}}.',
    },
  ],
};

export const WHATSAPP_TEST_SCENARIOS: Scenario[] = [GOLDEN_PATH];

export function getWhatsAppTestScenario(id: string): Scenario | undefined {
  return WHATSAPP_TEST_SCENARIOS.find((scenario) => scenario.id === id);
}

export function listWhatsAppTestScenarios(): Scenario[] {
  return [...WHATSAPP_TEST_SCENARIOS];
}

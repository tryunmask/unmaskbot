export type ScenarioRole = "persona" | "scout" | "talent" | "company";

export type ScenarioStep = {
  id: string;
  to: Exclude<ScenarioRole, "persona">;
  prompt: string;
  fallbackReply?: string;
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
  description: "Persona adapts to each role (scout, talent, company) and replies after inbound.",
  steps: [
    {
      id: "persona-accepts-scout",
      to: "scout",
      prompt:
        "You are a scout. Refer {{candidate_name}} to the network. Phone: {{candidate_phone}}. LinkedIn: {{candidate_linkedin}}.",
      fallbackReply:
        "Hey! I'd like to refer {{candidate_name}}. Strong software engineer. Phone: {{candidate_phone}}.",
    },
    {
      id: "persona-requests-intro",
      to: "talent",
      prompt:
        "You are the candidate {{candidate_name}}. Ask for a warm intro to {{intro_company}} and keep it short.",
      fallbackReply:
        "Hi! I'm {{candidate_name}} and would love a warm intro to {{intro_company}} if possible. Thanks!",
    },
    {
      id: "company-confirms-intro",
      to: "company",
      prompt:
        "You are {{company_user_name}}, a {{company_name}} executive. When told {{candidate_name}} requested an intro, accept it and keep it short.",
      fallbackReply: "Yes, please proceed with {{candidate_name}}'s intro. Approved on my end.",
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

import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { danger } from "../globals.js";
import { theme } from "../terminal/theme.js";
import { formatHelpExamples } from "./help-format.js";
import { collectOption, parsePositiveIntOrUndefined } from "./program/helpers.js";
import {
  listWhatsAppTestScenarios,
  getWhatsAppTestScenario,
} from "../whatsapp/testing/scenarios.js";
import { runWhatsAppTestScenario } from "../whatsapp/testing/runner.js";

const buildAutoTag = () => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  const stamp = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join("");
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
  return `run-${stamp}-${time}`;
};

export function registerWhatsAppTestCli(program: Command) {
  const whatsapp = program
    .command("whatsapp-test")
    .description("WhatsApp test harness for production agents");

  whatsapp
    .command("list")
    .description("List available scenarios")
    .action(() => {
      const scenarios = listWhatsAppTestScenarios();
      for (const scenario of scenarios) {
        defaultRuntime.log(`${scenario.id} - ${scenario.label}`);
      }
    });

  whatsapp
    .command("describe <scenario>")
    .description("Show the steps for a scenario")
    .action((scenarioId) => {
      const scenario = getWhatsAppTestScenario(String(scenarioId));
      if (!scenario) {
        defaultRuntime.error(danger(`Unknown scenario: ${scenarioId}`));
        defaultRuntime.exit(1);
        return;
      }
      defaultRuntime.log(`${scenario.id}: ${scenario.label}`);
      defaultRuntime.log(scenario.description);
      for (const step of scenario.steps) {
        defaultRuntime.log(`- ${step.id}: persona → ${step.to}`);
      }
    });

  whatsapp
    .command("help")
    .description("Show usage and option details")
    .action(() => {
      defaultRuntime.log(
        `
Usage:
  moltbot whatsapp-test run <scenario> [options]

Key roles:
  Scout user persona:   --scout-persona-agent scout-user
  Talent user persona:  --talent-persona-agent talent-user
  Company user persona: --company-persona-agent company-user

Targets:
  --persona-target <jid> --scout-target <jid> --talent-target <jid> --company-target <jid>

Accounts:
  --persona-account <id> --scout-account <id> --talent-account <id> --company-account <id>

Behavior:
  --reset-before               Send /reset to targets before run
  --followup-turns <count>     Max back-and-forth turns per agent
  --followup-timeout <seconds> Wait limit for follow-up replies
  --split-messages             Split persona replies into short messages
  --split-max-chars <count>    Max chars per split message
  --split-delay <ms>           Delay between split messages

Shared data (used across all flows):
  --candidate-name <value>
  --candidate-phone <value>
  --candidate-email <value>
  --candidate-linkedin <value>
  --intro-company <name>
  --company-name <value>
  --company-user-name <value>

Safety:
  --allow-target <jid> (repeatable)
  --allow-any-target
`,
      );
    });

  whatsapp
    .command("run <scenario>")
    .description("Run a WhatsApp scenario using the configured agents")
    .requiredOption("--persona-target <jid>", "WhatsApp target for the persona")
    .requiredOption("--scout-target <jid>", "WhatsApp target for the scout agent")
    .requiredOption("--talent-target <jid>", "WhatsApp target for the talent agent")
    .requiredOption("--company-target <jid>", "WhatsApp target for the company agent")
    .option("--persona-agent <id>", "Agent id to draft persona messages")
    .option("--scout-persona-agent <id>", "Persona agent id for scout flow", "scout-user")
    .option("--talent-persona-agent <id>", "Persona agent id for talent flow", "talent-user")
    .option("--company-persona-agent <id>", "Persona agent id for company flow", "company-user")
    .option("--scout-agent <id>", "Agent id for the scout agent", "scout")
    .option("--talent-agent <id>", "Agent id for the talent agent", "talent")
    .option("--company-agent <id>", "Agent id for the company agent", "company")
    .option("--channel <channel>", "Delivery channel", "whatsapp")
    .option("--account <id>", "Default channel account id (accountId)")
    .option("--persona-account <id>", "Account id for persona sends")
    .option("--scout-account <id>", "Account id for scout sends")
    .option("--talent-account <id>", "Account id for talent sends")
    .option("--company-account <id>", "Account id for company sends")
    .option("--persona-name <name>", "Persona display name")
    .option("--persona-contact <value>", "Persona contact details to share")
    .option("--persona-linkedin <value>", "Persona LinkedIn URL")
    .option("--intro-company <name>", "Target company for intro", "Anthropic")
    .option("--candidate-name <value>", "Candidate name", "Henry Allen")
    .option("--candidate-phone <value>", "Candidate phone number", "+447484718110")
    .option("--candidate-email <value>", "Candidate email", "henry.allen@example.com")
    .option(
      "--candidate-linkedin <value>",
      "Candidate LinkedIn URL",
      "https://www.linkedin.com/in/henry-allen",
    )
    .option("--company-name <value>", "Company name (company flow)", "Anthropic")
    .option("--company-user-name <value>", "Company contact name", "Alex")
    .option("--tag <value>", "Override the auto tag prefix")
    .option("--response-timeout <seconds>", "Wait limit for agent replies")
    .option("--followup-timeout <seconds>", "Wait limit for follow-up replies")
    .option("--followup-turns <count>", "Max follow-up turns per agent")
    .option("--poll-interval <ms>", "Polling interval for replies (ms)")
    .option("--wait <ms>", "Delay between steps (milliseconds)")
    .option("--reset-before", "Send /reset to each target before running")
    .option("--reset-message <text>", "Message to send for reset", "/reset")
    .option("--split-messages", "Split persona replies into shorter messages")
    .option("--split-max-chars <count>", "Max chars per split message", "140")
    .option("--split-delay <ms>", "Delay between split messages (ms)", "800")
    .option("--allow-target <jid>", "Allowlist target (repeatable)", collectOption, [])
    .option("--allow-any-target", "Disable allowlist safety checks", false)
    .option("--no-deliver", "Generate replies without sending to WhatsApp")
    .option("--json", "Output JSON summary", false)
    .addHelpText(
      "after",
      () =>
        `
${theme.heading("Examples:")}
${formatHelpExamples([
  ["moltbot whatsapp-test list", "List available WhatsApp scenarios."],
  ["moltbot whatsapp-test describe golden-path", "Show the steps in the golden path scenario."],
  [
    "moltbot whatsapp-test run golden-path --persona-target +15555550123 --scout-target +15555550124 --talent-target +15555550125 --company-target +15555550126 --allow-target +15555550123 --allow-target +15555550124 --allow-target +15555550125 --allow-target +15555550126",
    "Run the full loop with explicit allowlist.",
  ],
  [
    "moltbot whatsapp-test run golden-path --persona-agent user-agent --persona-target +15555550123 --scout-target +15555550124 --talent-target +15555550125 --company-target +15555550126 --allow-any-target",
    "Generate natural replies with the persona agent.",
  ],
  [
    "moltbot whatsapp-test run golden-path --persona-agent user-agent --persona-target +15555550123 --scout-target +15555550124 --talent-target +15555550125 --company-target +15555550126 --reset-before --allow-any-target",
    "Reset agent sessions before the scenario.",
  ],
  [
    "moltbot whatsapp-test run golden-path --persona-target +15555550123 --scout-target +15555550124 --talent-target +15555550125 --company-target +15555550126 --no-deliver",
    "Generate replies without sending.",
  ],
])}

Notes:
- This runner sends WhatsApp messages to the agents and waits for their replies.
- Replies are read from the session transcript, so the gateway must be running.
- When --persona-agent is set, the persona waits for each agent to message first.
- Use --followup-turns to allow back-and-forth replies after the first response.
`,
    )
    .action(async (scenarioId, opts) => {
      try {
        const responseTimeoutSeconds = parsePositiveIntOrUndefined(opts.responseTimeout);
        const followupTimeoutSeconds = parsePositiveIntOrUndefined(opts.followupTimeout);
        const followupTurns = parsePositiveIntOrUndefined(opts.followupTurns);
        const pollIntervalMs = parsePositiveIntOrUndefined(opts.pollInterval);
        const waitMs = parsePositiveIntOrUndefined(opts.wait);
        const splitMaxChars = parsePositiveIntOrUndefined(opts.splitMaxChars);
        const splitDelayMs = parsePositiveIntOrUndefined(opts.splitDelay);
        const result = await runWhatsAppTestScenario({
          scenarioId: String(scenarioId),
          channel: opts.channel,
          accountId: opts.account,
          accountIds: {
            persona: opts.personaAccount,
            scout: opts.scoutAccount,
            talent: opts.talentAccount,
            company: opts.companyAccount,
          },
          agentIds: {
            scout: opts.scoutAgent,
            talent: opts.talentAgent,
            company: opts.companyAgent,
          },
          personaAgentId: opts.personaAgent,
          scoutPersonaAgentId: opts.scoutPersonaAgent,
          talentPersonaAgentId: opts.talentPersonaAgent,
          companyPersonaAgentId: opts.companyPersonaAgent,
          targets: {
            persona: opts.personaTarget,
            scout: opts.scoutTarget,
            talent: opts.talentTarget,
            company: opts.companyTarget,
          },
          allowTargets: Array.isArray(opts.allowTarget) ? opts.allowTarget : [],
          allowAnyTarget: Boolean(opts.allowAnyTarget),
          tag: opts.tag ?? buildAutoTag(),
          personaName: opts.personaName,
          personaContact: opts.personaContact,
          personaLinkedIn: opts.personaLinkedin,
          introCompany: opts.introCompany,
          candidateName: opts.candidateName,
          candidatePhone: opts.candidatePhone,
          candidateEmail: opts.candidateEmail,
          candidateLinkedIn: opts.candidateLinkedin,
          companyName: opts.companyName,
          companyUserName: opts.companyUserName,
          responseTimeoutSeconds: responseTimeoutSeconds ?? undefined,
          followupTimeoutSeconds: followupTimeoutSeconds ?? undefined,
          followupMaxTurns: followupTurns ?? undefined,
          pollIntervalMs: pollIntervalMs ?? undefined,
          deliver: opts.deliver,
          waitMs: waitMs ?? undefined,
          resetBefore: Boolean(opts.resetBefore),
          resetMessage: opts.resetMessage,
          splitMessages: Boolean(opts.splitMessages),
          splitMaxChars: splitMaxChars ?? undefined,
          splitDelayMs: splitDelayMs ?? undefined,
          runtime: defaultRuntime,
        });

        if (opts.json) {
          defaultRuntime.log(JSON.stringify(result, null, 2));
          return;
        }
        defaultRuntime.log(`Done. Steps: ${result.results.length}`);
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}

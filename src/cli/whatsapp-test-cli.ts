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

export function registerWhatsAppTestCli(program: Command) {
  const whatsapp = program
    .command("whatsapp-test")
    .description("WhatsApp test harness for agent-to-agent scenarios");

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
        defaultRuntime.log(`- ${step.id}: ${step.from} → ${step.to}`);
      }
    });

  whatsapp
    .command("run <scenario>")
    .description("Run a WhatsApp scenario using the configured agents")
    .requiredOption("--persona-target <jid>", "WhatsApp target for the persona")
    .requiredOption("--scout-target <jid>", "WhatsApp target for the scout agent")
    .requiredOption("--talent-target <jid>", "WhatsApp target for the talent agent")
    .requiredOption("--company-target <jid>", "WhatsApp target for the company agent")
    .option("--persona-agent <id>", "Agent id for the persona", "persona")
    .option("--scout-agent <id>", "Agent id for the scout agent", "scout")
    .option("--talent-agent <id>", "Agent id for the talent agent", "talent")
    .option("--company-agent <id>", "Agent id for the company agent", "company")
    .option("--persona-session-id <id>", "Session id override for the persona")
    .option("--scout-session-id <id>", "Session id override for the scout agent")
    .option("--talent-session-id <id>", "Session id override for the talent agent")
    .option("--company-session-id <id>", "Session id override for the company agent")
    .option("--channel <channel>", "Delivery channel", "whatsapp")
    .option("--account <id>", "Channel account id (accountId)")
    .option("--persona-name <name>", "Persona display name")
    .option("--persona-contact <value>", "Persona contact details to share")
    .option("--tag <value>", "Prefix tag added to each message")
    .option("--thinking <level>", "Thinking level for all agents")
    .option("--timeout <seconds>", "Agent timeout in seconds")
    .option("--wait <ms>", "Delay between steps (milliseconds)")
    .option("--allow-target <jid>", "Allowlist target (repeatable)", collectOption, [])
    .option("--allow-any-target", "Disable allowlist safety checks", false)
    .option("--no-deliver", "Generate replies without sending to WhatsApp", false)
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
    "moltbot whatsapp-test run golden-path --persona-target +15555550123 --scout-target +15555550124 --talent-target +15555550125 --company-target +15555550126 --no-deliver",
    "Generate replies without sending.",
  ],
])}

Notes:
- This runner generates messages by running the agents and can deliver them to WhatsApp.
- It does not wait for inbound WhatsApp replies; instead it feeds each agent the prior step output.
`,
    )
    .action(async (scenarioId, opts) => {
      try {
        const timeoutSeconds = parsePositiveIntOrUndefined(opts.timeout);
        const waitMs = parsePositiveIntOrUndefined(opts.wait);
        const result = await runWhatsAppTestScenario({
          scenarioId: String(scenarioId),
          channel: opts.channel,
          accountId: opts.account,
          agentIds: {
            persona: opts.personaAgent,
            scout: opts.scoutAgent,
            talent: opts.talentAgent,
            company: opts.companyAgent,
          },
          sessionIds: {
            persona: opts.personaSessionId,
            scout: opts.scoutSessionId,
            talent: opts.talentSessionId,
            company: opts.companySessionId,
          },
          targets: {
            persona: opts.personaTarget,
            scout: opts.scoutTarget,
            talent: opts.talentTarget,
            company: opts.companyTarget,
          },
          allowTargets: Array.isArray(opts.allowTarget) ? opts.allowTarget : [],
          allowAnyTarget: Boolean(opts.allowAnyTarget),
          tag: opts.tag,
          personaName: opts.personaName,
          personaContact: opts.personaContact,
          thinking: opts.thinking,
          timeoutSeconds: timeoutSeconds ?? undefined,
          deliver: opts.deliver,
          waitMs: waitMs ?? undefined,
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

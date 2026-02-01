---
name: whatsapp-test-runner
description: Runs the Moltbot WhatsApp test harness CLI for persona/Scout/Talent/Company intro scenarios. Use when asked to run WhatsApp test scenarios, validate agent handoffs, or automate the WhatsApp persona flow.
---

# WhatsApp Test Runner

## Quick Start
Use the CLI to run the golden path scenario and enforce a strict allowlist:

```bash
moltbot whatsapp-test run golden-path \
  --scout-persona-agent scout-user \
  --talent-persona-agent talent-user \
  --company-persona-agent company-user \
  --persona-target +15555550123 \
  --scout-target +15555550124 \
  --talent-target +15555550125 \
  --company-target +15555550126 \
  --allow-target +15555550123 \
  --allow-target +15555550124 \
  --allow-target +15555550125 \
  --allow-target +15555550126
```

## Help
Use the built-in help for options:

```bash
moltbot whatsapp-test help
```

## Key Notes
- The runner sends WhatsApp messages to the agents and waits for their replies.
- Replies are read from the session transcript; the gateway must be running.
- Use the role-specific persona agents to generate natural replies.
- When `--persona-agent` is set, the persona waits for each agent to message first.
- Use `--followup-turns 2` to allow back-and-forth replies after the first response.
- Use `--no-deliver` to generate replies without sending.
- Use `--reset-before` to send `/reset` to each target before the run.
- Use `--split-messages` for shorter, more human replies.
- A run tag is auto-generated and prefixed on persona messages.
- Use `--tag <value>` to override the auto tag.
- Use `--candidate-*` and `--company-*` flags to keep shared data consistent.
- Ensure the persona WhatsApp account is linked and active.

## Default persona agents
- Scout user persona: `scout-user`
- Talent user persona: `talent-user`
- Company user persona: `company-user`

## Useful Commands
List and inspect scenarios:

```bash
moltbot whatsapp-test list
moltbot whatsapp-test describe golden-path
```

Customize the persona’s details:

```bash
moltbot whatsapp-test run golden-path \
  --persona-contact "test.persona@example.com | +15555550123"
```

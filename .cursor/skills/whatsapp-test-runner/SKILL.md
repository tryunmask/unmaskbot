---
name: whatsapp-test-runner
description: Runs the Moltbot WhatsApp test harness CLI for persona/Scout/Talent/Company intro scenarios. Use when asked to run WhatsApp test scenarios, validate agent handoffs, or automate the WhatsApp persona flow.
---

# WhatsApp Test Runner

## Quick Start
Use the CLI to run the golden path scenario and enforce a strict allowlist:

```bash
moltbot whatsapp-test run golden-path \
  --persona-target +15555550123 \
  --scout-target +15555550124 \
  --talent-target +15555550125 \
  --company-target +15555550126 \
  --allow-target +15555550123 \
  --allow-target +15555550124 \
  --allow-target +15555550125 \
  --allow-target +15555550126
```

## Key Notes
- The runner generates messages by running agents and can deliver them to WhatsApp.
- It does not wait for inbound WhatsApp replies; it feeds each agent the prior step output.
- Use `--no-deliver` to generate replies without sending.
- Ensure the gateway is running and WhatsApp is linked.

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

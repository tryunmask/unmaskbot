## Unmask Build Plan

### Core goals
- Launch WhatsApp-based agents for scout, talent, and company.
- Keep onboarding lean and purpose-built for Unmask.
- Replace Moltbot branding and legacy product language.
- Support multi-agent workflow with clear workstreams and docs.

### Phase 1 — Working MVP (now)
- WhatsApp scout agent working on a single number.
- Unmask tools plugin wired to backend endpoints.
- Agent prompts set for scout/talent/company.
- Safe local testing (self-chat / allowlist).

### Phase 2 — Stabilize workflows
- Add should-respond guardrails in tools or model policy.
- Tighten onboarding copy and minimum required fields.
- Add validation + dedupe on outbound messages.
- Add structured logging for tool calls.
- Define per-user memory strategy for shared inboxes (avoid cross-user leakage).

### Phase 3 — Productization
- Remove or disable unrelated Moltbot features.
- Rebrand CLI, config paths, docs, and user-facing text.
- Prepare Docker setup and deploy runbook.
- Add CI checks tailored to Unmask.

### Phase 4 — Multi-agent expansion
- Enable talent + company WhatsApp numbers.
- Add admin tooling for pairing and allowlists.
- Add a small “admin agent” or CLI helpers for support ops.

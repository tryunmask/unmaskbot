# Unmask Gateway Bootstrap

This folder contains Unmask agent workspace templates and a sample config.

## Quick start (local)
1) Copy agent templates to a workspace path (one per agent).
2) Create `~/.clawdbot/moltbot.json` from `config/unmask.example.json5`.
3) Link WhatsApp accounts (scout, talent, company) via `moltbot channels login --account <id>`.
4) Start the gateway.

## Agent workspaces
Template paths:
- `unmask/agents/scout`
- `unmask/agents/talent`
- `unmask/agents/company`

Each workspace includes `AGENTS.md`, `SOUL.md`, `USER.md`, and `TOOLS.md`.

## Config sample
See `config/unmask.example.json5` for:
- `agents.list` (scout, talent, company)
- `bindings` for WhatsApp account routing
- plugin enablement for Unmask tools

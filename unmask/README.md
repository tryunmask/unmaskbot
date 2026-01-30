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

## Backend API
See `unmask/API.md` for the gateway-to-backend endpoint contract.

## Mock API (local)
Use the mock API when you want tool calls to succeed without a real backend.

Run:
- `UNMASK_MOCK_PORT=4010 UNMASK_API_TOKEN=dev bun scripts/unmask-mock-api.ts`

Then set in config or env:
- `UNMASK_API_BASE_URL=http://localhost:4010`
- `UNMASK_API_TOKEN=dev`

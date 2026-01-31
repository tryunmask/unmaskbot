# Unmask Gateway Bootstrap

This folder contains Unmask agent workspace templates and a sample config.

## Quick start (Docker)
1) Copy agent templates to a workspace path (one per agent).
2) Create `./.unmask/unmask.json` (repo-local) from `config/unmask.example.json5`.
3) Run `./docker-setup.sh` to build and start the gateway container.
4) Link WhatsApp accounts (scout, talent, company) via `docker compose run --rm moltbot-cli channels login --account <id>`.

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

## Convex backend (hosted)
The Convex backend lives in `/convex` and exposes the HTTP routes in `unmask/API.md`.

### First-time setup
```bash
# 1. Deploy schema and create tables
npx convex dev --once

# 2. Set the API token in Convex
npx convex env set UNMASK_API_TOKEN "your-secret-token"

# 3. Configure gateway (via moltbot config)
pnpm moltbot config set plugins.unmask.config.apiBaseUrl "https://your-deployment.convex.site"
pnpm moltbot config set plugins.unmask.config.apiToken "your-secret-token"
```

### Local development with hot reload
```bash
# Terminal 1: Convex backend (auto-deploys on save)
npx convex dev

# Terminal 2: Gateway with hot reload
pnpm gateway:watch --port 18789
```

### Docker workflow (no hot reload)
```bash
# Rebuild after code changes
pnpm build && docker compose up -d --build moltbot-gateway
```

### View Convex logs
```bash
npx convex logs              # Stream live logs
npx convex logs --history 50 # Recent history
```

Dashboard: `https://dashboard.convex.dev/d/your-deployment-name`

## Outbound poller (talent invites)
The gateway runs a light outbound poller that claims queued messages from Convex and sends them over WhatsApp. It uses the same `UNMASK_API_BASE_URL` and `UNMASK_API_TOKEN` as the tool plugin, and backs off when no work is found.

Queue endpoints:
- `POST /v1/outbound/claim`
- `POST /v1/outbound/mark`

## Mock API (local)
Use the mock API when you want tool calls to succeed without a real backend.

Run:
- `UNMASK_MOCK_PORT=4010 UNMASK_API_TOKEN=dev bun scripts/unmask-mock-api.ts`

Then set in config or env:
- `UNMASK_API_BASE_URL=http://localhost:4010`
- `UNMASK_API_TOKEN=dev`

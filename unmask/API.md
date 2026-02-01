# Unmask Gateway API (System of Record)

This document captures the HTTP endpoints used by the Unmask tool plugin.
The backend (Convex) is the system of record. The gateway is stateless.

## Convex Backend Setup

### Initial Setup

1. **Install Convex CLI** (already included in package.json):
   ```bash
   pnpm install
   ```

2. **Start Convex dev server** (creates deployment and deploys schema):
   ```bash
   npx convex dev --once
   ```
   This creates:
   - `.env.local` with `CONVEX_DEPLOYMENT`, `CONVEX_URL`, and `CONVEX_SITE_URL`
   - Tables defined in `convex/schema.ts`
   - HTTP routes from `convex/http.ts`

3. **Set the API token in Convex**:
   ```bash
   npx convex env set UNMASK_API_TOKEN "your-secret-token"
   ```

4. **Configure the gateway** (in moltbot config or `.env`):
   ```bash
   # Via moltbot config (recommended)
   pnpm moltbot config set plugins.unmask.config.apiBaseUrl "https://your-deployment.convex.site"
   pnpm moltbot config set plugins.unmask.config.apiToken "your-secret-token"
   
   # Or via .env
   UNMASK_API_BASE_URL=https://your-deployment.convex.site
   UNMASK_API_TOKEN=your-secret-token
   ```

### Convex File Structure

```
convex/
├── _generated/       # Auto-generated types (commit these)
├── schema.ts         # Database schema (tables, indexes)
├── http.ts           # HTTP routes (API endpoints)
├── httpHelpers.ts    # Response helpers (jsonResponse, jsonError)
├── auth.ts           # Bearer token validation
├── referrals.ts      # Internal queries/mutations for referrals
├── scouts.ts         # Internal queries/mutations for scouts
├── talent.ts         # Internal queries/mutations for talent
├── intros.ts         # Internal queries/mutations for intros
└── outbound.ts       # Internal queries/mutations for outbound messages
```

### Important: HTTP Actions and Database Access

Convex `httpAction` handlers do NOT have direct `ctx.db` access. Instead, use:
- `ctx.runQuery(internal.module.functionName, args)` for reads
- `ctx.runMutation(internal.module.functionName, args)` for writes

Example:
```typescript
// convex/http.ts
import { internal } from "./_generated/api.js";

http.route({
  path: "/v1/scout/referrals",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Use ctx.runQuery/runMutation, NOT ctx.db
    const existing = await ctx.runQuery(internal.referrals.findByPhoneAndScout, {
      phone,
      scoutPhone,
    });
    // ...
  }),
});
```

### File Naming Rules

Convex module names cannot contain hyphens. Use camelCase:
- `httpHelpers.ts` (correct)
- `http-helpers.ts` (will fail deployment)

## Local Development and Hot Reload

### Gateway Hot Reload

For local development with hot reload on gateway code changes:

```bash
# Stop any Docker gateway first
docker compose stop moltbot-gateway

# Run gateway with watch mode
pnpm gateway:watch --port 18789
```

This watches for changes in `src/` and `extensions/` and automatically restarts.

### Convex Hot Reload

For Convex backend changes, keep the dev server running:

```bash
npx convex dev
```

This:
- Watches `convex/` folder for changes
- Auto-deploys on save
- Updates TypeScript types in `convex/_generated/`
- Shows real-time logs in terminal

### Docker Workflow (No Hot Reload)

When running via Docker, code is baked into the image:

```bash
# Rebuild and restart after code changes
pnpm build && docker compose up -d --build moltbot-gateway
```

### Viewing Convex Logs

```bash
# Stream logs from your deployment
npx convex logs

# Show recent history
npx convex logs --history 50
```

### Convex Dashboard

View data and run functions at:
```
https://dashboard.convex.dev/d/your-deployment-name
```

## Auth
- Header: `Authorization: Bearer <token>`
- Content-Type: `application/json`

## Endpoints

### 1) Should respond
`POST /v1/agents/should-respond`

Purpose: guardrail check for whether the agent should reply or act.

Request:
```json
{
  "eventType": "user_text | user_quick_reply | system_template | system_action | flow_complete",
  "message": "string (optional)",
  "phase": "string (optional)",
  "lastOutboundType": "string (optional)",
  "lastAction": "string (optional)",
  "silent": true,
  "doNotRespond": true,
  "flags": {
    "silent": true,
    "doNotRespond": true,
    "canProceed": true
  }
}
```

Response:
```json
{
  "shouldRespond": true,
  "reason": "string",
  "source": "policy | backend | fallback",
  "user": { "name": "string (optional)" }
}
```

When the backend knows the sender (e.g. by phone in Convex), it may include `user.name` so the agent can personalize without asking.

### 2) Create scout referral
`POST /v1/scout/referrals`

Request:
```json
{
  "phone": "+15555550123",
  "name": "string (optional)",
  "linkedin": "string (optional)",
  "notes": "string (optional)",
  "scoutPhone": "+15555550100 (optional)",
  "source": "string (optional)"
}
```

Response:
```json
{
  "id": "referral_123",
  "status": "created | exists | updated"
}
```

### 3) Onboard talent
`POST /v1/talent/onboard`

Request:
```json
{
  "phone": "+15555550123",
  "fullName": "string (optional)",
  "role": "string (optional)",
  "location": "string (optional)",
  "linkedin": "string (optional)",
  "notes": "string (optional)",
  "scoutPhone": "+15555550100 (optional)"
}
```

Response:
```json
{
  "id": "talent_123",
  "status": "ok | updated"
}
```

### 4) Request intro
`POST /v1/talent/intro-request`

Request:
```json
{
  "talentPhone": "+15555550123",
  "companyId": "string (optional)",
  "companyName": "string (optional)",
  "reason": "string",
  "notes": "string (optional)"
}
```

Response:
```json
{
  "id": "intro_123",
  "status": "requested"
}
```

### 5) Accept intro
`POST /v1/company/intro-accept`

Request:
```json
{
  "introId": "intro_123",
  "companyPhone": "+15555550100 (optional)",
  "notes": "string (optional)"
}
```

Response:
```json
{
  "status": "accepted"
}
```

### 6) Decline intro
`POST /v1/company/intro-decline`

Request:
```json
{
  "introId": "intro_123",
  "reason": "string",
  "companyPhone": "+15555550100 (optional)"
}
```

Response:
```json
{
  "status": "declined"
}
```

### 7) Enqueue outbound message
`POST /v1/outbound/enqueue`

Request:
```json
{
  "toPhone": "+15555550123",
  "message": "string",
  "agentId": "string (optional)",
  "channel": "string (optional)",
  "accountId": "string (optional)"
}
```

Response:
```json
{
  "id": "outbound_123",
  "status": "pending"
}
```

### 8) Claim outbound messages
`POST /v1/outbound/claim`

Request:
```json
{
  "limit": 5
}
```

Response:
```json
{
  "items": [
    {
      "id": "outbound_123",
      "toPhone": "+15555550123",
      "message": "string",
      "agentId": "string (optional)",
      "channel": "string (optional)",
      "accountId": "string (optional)",
      "attempts": 1
    }
  ]
}
```

### 9) Mark outbound status
`POST /v1/outbound/mark`

Request:
```json
{
  "id": "outbound_123",
  "status": "sent | failed",
  "error": "string (optional)"
}
```

Response:
```json
{
  "status": "sent | failed"
}
```

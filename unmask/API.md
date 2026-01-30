# Unmask Gateway API (System of Record)

This document captures the HTTP endpoints used by the Unmask tool plugin.
The backend (Convex) is the system of record. The gateway is stateless.

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
  "source": "policy | backend | fallback"
}
```

### 2) Create scout referral
`POST /v1/scout/referrals`

Request:
```json
{
  "phone": "+15555550123",
  "name": "string (optional)",
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

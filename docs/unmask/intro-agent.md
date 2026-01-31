---
title: Intro Agent
description: Group chat facilitation for talent-company introductions
---

# Intro Agent

The **Intro Agent** handles group chat conversations between talent and companies after an introduction is accepted.

## Overview

When a company accepts an intro request, a WhatsApp group is created with three participants:
1. The talent
2. The company contact
3. The Unmask bot (company account)

The Intro Agent facilitates the introduction, then steps back to let the conversation flow naturally.

## Behavior

### Phase 1: Opening Message

When the agent enters a group chat, it sends **one** warm intro message:

```
Hey Henry! Thought I'd connect you both. Take it from here!
```

The message uses the talent's first name from context when available.

### Phase 2: Silent Observation

After the intro message, the agent enters strict **NO_REPLY** mode:
- Does not respond to any messages
- Does not answer questions (even if directly asked)
- Does not offer help or suggestions
- Simply observes the conversation

### Phase 3: Closing Message

When the conversation naturally concludes, the agent sends **one** closing message:

```
Great connecting you both! Enjoy the chat.
```

Signs that a conversation has concluded:
- Exchange of contact details (email, phone, LinkedIn)
- Scheduling a meeting or call
- Explicit goodbyes or "nice to meet you"

After the closing message, the agent returns to permanent NO_REPLY mode.

## Routing Configuration

The Intro Agent is routed to handle group chats on the company WhatsApp account:

```json5
bindings: [
  // Groups on company account → intro agent
  {
    match: { channel: "whatsapp", accountId: "company", peer: { kind: "group" } },
    agentId: "intro"
  },
  // DMs on company account → company agent (catch-all)
  {
    match: { channel: "whatsapp", accountId: "company" },
    agentId: "company"
  }
]
```

Note: The group binding must come **before** the catch-all company binding since bindings are matched in order.

## Creating an Intro Group

Groups are created programmatically when an intro is accepted:

```bash
# Via CLI
unmaskbot message group-create \
  --channel whatsapp \
  --account company \
  --subject "Henry <> Leo | Unmask" \
  --participant "+447484718110" \
  --participant "+447927612815"
```

Or via the gateway tools API:

```bash
curl -X POST http://localhost:18789/tools/invoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "message",
    "args": {
      "action": "group-create",
      "channel": "whatsapp",
      "subject": "Henry <> Leo | Unmask",
      "participants": ["+447484718110", "+447927612815"],
      "accountId": "company"
    }
  }'
```

## Group Naming Convention

Groups follow the naming pattern:

```
{TalentFirstName} <> {CompanyContactFirstName} | Unmask
```

Example: `Henry <> Leo | Unmask`

## Agent Workspace

The Intro Agent workspace is located at `unmask/agents/intro/` and contains:

- `AGENTS.md` - Mission and response rules
- `SOUL.md` - Personality and tone
- `TOOLS.md` - Available tools (only `unmask_should_respond`)

## Design Principles

1. **Minimal presence**: The agent sends at most 2 messages (intro + closing)
2. **No interference**: Never responds to questions or engages in conversation
3. **Warm but brief**: Messages are friendly but short
4. **Context-aware**: Uses names from injected context when available

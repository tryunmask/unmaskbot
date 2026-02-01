---
summary: "Platform support overview (Gateway)"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
---
# Platforms

Moltbot core is written in TypeScript. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (WhatsApp/Telegram bugs).

The Gateway runs headlessly on server-class hosts. Companion apps are no longer part of this repo.

## Choose your OS

- Linux: [Linux](/platforms/linux)
- Raspberry Pi: [Raspberry Pi](/platforms/raspberry-pi)

## VPS & hosting

- VPS hub: [VPS hosting](/vps)
- Fly.io: [Fly.io](/platforms/fly)
- Hetzner (Docker): [Hetzner](/platforms/hetzner)
- GCP (Compute Engine): [GCP](/platforms/gcp)
- exe.dev (VM + HTTPS proxy): [exe.dev](/platforms/exe-dev)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `moltbot gateway status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `moltbot onboard --install-daemon`
- Direct: `moltbot gateway install`
- Configure flow: `moltbot configure` → select **Gateway service**
- Repair/migrate: `moltbot doctor` (offers to install or fix the service)

The service target depends on OS:
- Linux: systemd user service (`moltbot-gateway[-<profile>].service`)

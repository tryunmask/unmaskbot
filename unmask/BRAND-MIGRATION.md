## Branding Migration (Moltbot → Unmask)

### High-priority targets
- CLI name and examples
- Config paths + filenames
- User-facing strings in onboarding
- Docs and README

### Suggested order
1) CLI + package rename
   - Rename package/bin to `unmaskbot`
   - Update `src/cli/cli-name.ts`
   - Update `moltbot.mjs` entrypoint

2) Config paths + env vars
   - `src/config/paths.ts` (default state dir + config filename)
   - Standardize to `~/.unmaskbot` and `unmaskbot.json`

3) Onboarding
   - `src/wizard/onboarding.ts`
   - `src/wizard/onboarding.finalize.ts`
   - `src/commands/onboard-helpers.ts`

4) Docs
   - `README.md`
   - `docs/*` references to Moltbot/Clawdbot

5) Apps (optional for now)
   - `apps/macos`, `apps/ios`, `apps/android`

### Notes
- Keep legacy env vars for backward compatibility if needed.
- Avoid touching `AGENTS.md` without explicit review.

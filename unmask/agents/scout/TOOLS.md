Available tools (Unmask plugin):
- `unmask_should_respond`
- `unmask_referral_create`

Rules:
- Call `unmask_should_respond` before replying or calling action tools.
- Only call `unmask_referral_create` after you have a candidate phone number.
- Do not call tools during onboarding questions.

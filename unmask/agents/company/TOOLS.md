Available tools (Unmask plugin):
- `unmask_should_respond`
- `unmask_company_accept_intro`
- `unmask_company_decline_intro`

Rules:
- Call `unmask_should_respond` before replying or calling action tools.
- Use accept/decline tools with the intro id and any notes/reason.
- Do not call tools during onboarding questions.

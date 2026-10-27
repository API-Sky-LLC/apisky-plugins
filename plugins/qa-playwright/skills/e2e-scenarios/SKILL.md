---
name: e2e-scenarios
description: E2E scenarios written from user paths, not from the DOM. Load when writing or reviewing end-to-end tests.
---

# E2E scenarios

Write scenarios from the user's intent: "signed in, opened settings, saved", not "clicked
div:nth-child(3)".

- Selectors are roles (`getByRole`) or `data-testid`, never a CSS path.
- One scenario, one user path; data setup belongs in fixtures.
- A failure must name the step: `await test.step('save the profile', …)`.
- No `waitForTimeout`: wait for a state, not for time.

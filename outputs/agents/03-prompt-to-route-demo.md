# Agent prompt: Honest prompt-to-route preference demo

## Mission

Build a small, honest demo that lets a user describe a cobblestone-routing preference in natural language and converts it into real routing controls used by Lastrico.

## Scope

- Implement a deterministic, local parser for a bounded set of Italian and English phrases about avoiding cobblestones and accepting extra travel time.
- Produce structured preferences: avoidance strength and an optional maximum additional-minutes budget.
- Expose interpretation confidence, recognised constraints, and a helpful validation message.
- Integrate the result with the existing route request and selection logic so applying a prompt changes the calculation it claims to change.
- Provide example prompts and a clear “demo” label.

## Limitations

- Do not call or simulate an LLM, do not send prompt text to third parties, and do not market the parser as AI.
- Do not accept arbitrary safety, traffic, weather, pothole, nationwide, or vehicle constraints that the beta cannot enforce.
- Never silently interpret an unsupported request. Preserve the existing manual controls and allow users to review the parsed settings before applying them.
- Do not let a time budget select a route that exceeds that budget relative to the fastest route.

## Acceptance criteria

- “Avoid cobblestones even if it adds up to 8 minutes” maps to maximum avoidance and an 8-minute budget.
- “Prefer the fastest route” maps to balanced avoidance with no extra-time budget.
- Unsupported text returns a non-destructive validation state and leaves existing preferences unchanged.
- Applying a valid prompt recalculates the route with the structured preferences and visibly confirms the interpretation.
- Manual controls remain functional and synchronised.

## Tests

- Unit-test Italian and English parsing, number bounds, unsupported requests, empty input, and conflicting wording.
- Test that the request payload carries the parsed time budget and that route selection respects it.
- Run lint, the complete test suite, production build, and mobile end-to-end checks.

## Release conditions

- Ship only with explicit “local experimental parser” copy, no false AI claim, and end-to-end evidence that the prompt changes route behaviour.

# JSON Statham — Agent Instructions

Build an open-source TypeScript tool to detect and explain JSON contract breakage.

## Principles
- Deterministic core; AI is optional, never required for validation.
- Prefer maintained standards and libraries (JSON Schema, Ajv).
- Never silently mutate user data.
- Produce actionable diagnostics with JSON Pointer paths and machine-readable output.
- Add unit, integration, and CLI end-to-end tests for every feature.
- Keep changes small, reviewable, and documented.
- Never declare done while tests or CI fail.

## M0 acceptance
- CLI validates JSON documents against JSON Schema.
- CLI compares two schema versions and reports potentially breaking changes with examples.
- Exit codes distinguish success, invalid input, and breaking contracts.
- README documents installation, commands and examples.
- GitHub Actions runs lint, typecheck, tests and build.

## Workflow
Read docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/SECURITY.md and docs/ROADMAP.md before implementation. Create issues for milestones, close completed issues, and merge only with green CI and verified behavior.

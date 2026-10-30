# Terminal portrait (T1, issue #3)

Scope: original, stylized monochrome ASCII portrait inspired by Jason Statham, in CLI help. No new dependency or terminal escape sequence.

Acceptance: `--help`/`-h` prints portrait, usage and both commands, exits 0; no arguments prints the same help with existing usage exit 2. Any `--json` request keeps a single machine report and existing usage semantics; validate/compare output stays unchanged. README explains invocation.

Work: add static help renderer; connect argument dispatch; real CLI regression tests; inspect terminal rendering; full checks; publish PR and verify CI. Visual likeness remains for human acceptance.

Evidence: initial focused regression run: 2 failing tests for missing help/portrait, JSON isolation test already PASS. `npm run check` PASS: formatting, lint, typecheck, build and all 17 tests. `node dist/cli.js --help` inspected: ASCII portrait and complete usage render without ANSI escapes. Remote CI PASS on Node 22 and 24: https://github.com/memolabs-dev/json-statham/actions/runs/41044465503 (implementation commit 3ed0bbd). PR #4 is open, not merged. Technical delivery #3 verified; visual acceptance tracked separately in #2. Status READY_FOR_MANUAL_ACCEPTANCE.

Integration follow-through: PR #4 is the primary live source for merge status. The exact head `29e0f35d2dbf1692b547d3e377762251fec8cc02` passed all four push/PR CI checks on Node 22/24 (run 41044566222). Diff review found no change to validation/comparison behavior; help argument handling preserves machine reports. Manual acceptance stays open in #2.

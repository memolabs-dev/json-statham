# Terminal portrait (T1, issue #3)

Scope: original, stylized monochrome ASCII portrait inspired by Jason Statham, in CLI help. No new dependency or terminal escape sequence.

Acceptance: `--help`/`-h` prints portrait, usage and both commands, exits 0; no arguments prints the same help with existing usage exit 2. Any `--json` request keeps a single machine report and existing usage semantics; validate/compare output stays unchanged. README explains invocation.

Work: add static help renderer; connect argument dispatch; real CLI regression tests; inspect terminal rendering; full checks; publish PR and verify CI. Visual likeness remains for human acceptance.

Evidence: initial focused regression run: 2 failing tests for missing help/portrait, JSON isolation test already PASS. `npm run check` PASS: formatting, lint, typecheck, build and all 17 tests. `node dist/cli.js --help` inspected: ASCII portrait and complete usage render without ANSI escapes. Remote CI pending.

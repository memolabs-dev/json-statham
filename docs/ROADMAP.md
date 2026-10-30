# Roadmap

M0: deterministic CLI validation, schema compatibility analysis, exit codes, tests, CI and examples.

M1: GitHub Action, PR annotations, baselines and library API.

M2: proposed migrations, dry-run, rollback and verified repairs.

M3: opt-in AI and visual/editor integrations.

Done means working E2E, green CI, documented behavior and closed issues.

## Current delivery state

M0 implementation is delivered; human CLI/portrait acceptance remains [#2](https://github.com/memolabs-dev/json-statham/issues/2).

M1 technical implementation is delivered: [Action and annotations #5](https://github.com/memolabs-dev/json-statham/issues/5), [baselines #8](https://github.com/memolabs-dev/json-statham/issues/8), and [typed library API #11](https://github.com/memolabs-dev/json-statham/issues/11). Status is READY_FOR_MANUAL_ACCEPTANCE, with human checks still open in [#6](https://github.com/memolabs-dev/json-statham/issues/6), [#9](https://github.com/memolabs-dev/json-statham/issues/9) and [#12](https://github.com/memolabs-dev/json-statham/issues/12). Local/CI and independent review evidence is in `.agent/project/`. No npm registry release has been performed by this delivery workflow.

M2 technical implementation is delivered: explicit migration proposals, bounded dry-run and verified in-memory rollback ([#14](https://github.com/memolabs-dev/json-statham/issues/14), PR #17), plus durable append-only file versions, exact-byte restore and interrupted recovery ([#16](https://github.com/memolabs-dev/json-statham/issues/16), [PR #19](https://github.com/memolabs-dev/json-statham/pull/19)). Both technical issues are CLOSED. Durable versions are accepted by Guillaume ([#18 CLOSED](https://github.com/memolabs-dev/json-statham/issues/18), 2026-10-30); first-slice human acceptance [#15](https://github.com/memolabs-dev/json-statham/issues/15) remains open. All ten exact-head CI checks passed on Linux/macOS Node22/24, including the documented durable workflow and real Action. Persistence publishes new files only, with no in-place overwrite. Schema-derived operation suggestions remain a separate optional design.

M3 remains future separately specified work; neither remaining M2 work nor M3 is a missing M1 acceptance criterion.

# M3 offline diagnostics — #20 — T3 HTML rendering boundary

## Intent and model

Guillaume selected local diagnostic visualization after accepting #18. Reuse deterministic validate/compare reports and DDD diagnostics/baselines. New domain term: Diagnostic view, an offline presentation of a contract check, never an authorization or compatibility proof. One writer. Existing approved public test seam: actual CLI and its emitted artifact. No library/UI framework dependency, new service, AI, telemetry or automatic browser launch. Existing errors/exit meanings unchanged.

Flow: explicit validate/compare --html → existing isolated evaluation → escaped static view → stdout → caller-selected redirection → local browser. The CLI never creates/overwrites the report file itself. Browser receives no document/schema values, synthetic counterexamples, file paths or raw JSON. Diagnostic paths can reveal property names.

## Requirements / acceptance

V1 HTML is explicit, validate/compare only. --json conflicts and duplicate --html or unsupported command usages fail exit2; errors with --html produce a complete safe HTML error report (JSON wins for conflicting format flags). Existing default/JSON/Action/package behavior unchanged. Preserve exit0/1/2/3.
V2 Present command, exact machine status plus plain explanation, active diagnostics with JSON Pointer/code/message, separately labeled accepted diagnostics, matching/stale baseline warning and counts. Show no-findings states without claiming semantic compatibility. Omit counterexamples and all input file paths/values.
V3 Escape all untrusted diagnostic content into text, never attributes/URLs/styles/scripts. Self-contained fixed CSS, no script/image/link/resource requests, CSP default-src none; style-src hash of exact static CSS; base-uri none; form-action none. No raw report JSON embedded. UTF8 doctype/lang/viewport/title. No partial truncation: fixed report byte cap1MiB returns a small HTML report-limit error with exit2 before stdout publication.
V4 Accessible responsive static document: heading hierarchy, landmarks, status words independent of color, readable reflow for long pointers/messages. Native details/summary optionally expands accepted findings; no asynchronous loading state. Focus-visible, system font offline, print styling. No network/browser persistence or JS controls.
V5 Verify actual CLI normal/error/unchanged/accepted/stale states, malicious property names, input-value omission, flag misuse, same exits/files unchanged and byte-limit behavior. Browser checks375/768/1024/1440 light/dark, screenshots, a11y audit and no external resources. Full pre-commit, package consumer, Linux/macOS CI and independent review before merge. Separate human acceptance.

## Design

Existing brand reference: README/terminal uses JSON Statham and plain diagnostic vocabulary; no existing visual UI or brand palette. Use a developer review document: left-aligned title, visible check verdict, inline counts and a vertically readable list of pointer/code/explanation groups; accepted findings in a native disclosure. Avoid dashboard chrome and marketing content. Tokens: paper#f5f7fb, surface#ffffff, ink#17243b, muted#45556d, border#bac5d5, action#234fbb; success#175c3c/warning#764600/error#a12332. Dark tokens separately. System sans body and system mono for pointer/code only. Max width76rem, body text68ch, spacing scale .5/1/1.5/2/3rem, border radius.5rem. No font/library/CDN or media assets needed. Loading N/A static; empty/error/partial-baseline/full states required. Contrast and overflow measured in browser.

## Work graph

A spec/model DONE (this pre-code spec, owner selection). B CLI valid report tracer TODO → C escaping/failure/format boundaries TODO → D accepted/stale/limits TODO → E docs/browser/full gates/review TODO → F PR/CI/merge/tracker TODO. No DONE without proof.

## Risks and coverage

R1 HTML injection HIGH: escape text, no untrusted markup/attributes, hash-only style CSP, real malicious CLI fixtures + independent review. R2 value leakage HIGH: selected diagnostic fields only, omit entire counterexample/source labels; payload-secret regressions. R3 false acceptance MEDIUM: exact status plus conservative caveat and accepted/stale separation, tests. R4 resources MEDIUM: reuse worker/input bounds and byte cap1MiB; test overflow. R5 accessibility MEDIUM: responsive semantic native HTML, browser measurements. All pending proof. Applicable: CLI UX/security/privacy/resources/errors/compatibility/packaging/offline/docs/a11y. N/A: auth/tenants/database/migration changes/AI/network/deploy/synchronization/cleanup. Retain existing M2 and Action boundaries.

## Evidence / handoff

Pending red-green CLI slices, browser verification, full gates/independent review/CI. Manual recipe will be README --html redirect/open generated report using examples; no live data needed. Final state READY_FOR_MANUAL_ACCEPTANCE after technical closure.

## Verification evidence — 2026-10-30

B–D DONE: actual CLI tracer red (usage exit2) → HTML green; duplicate/conflicting flags red → green; accepted disclosure/stale warning red → green; oversized artifact real exit3 red → bounded complete exit2 fallback green. Five focused CLI tests PASS, including hostile text/CSP hash/value omission and input preservation. Full npm run check PASS82/82, installed tarball ESM/TypeScript/CLI included.

Browser: Chromium via isolated agent-browser session statham-m3, actual file:// CLI artifacts;40 measurements using ui-craft measure function on accepted/invalid/valid/input-error/hostile-long-pointer at375/768/1024/1440, light/dark. Zero overflow, contrast, target/input failures. Script iframe wrapper replaced with direct per-viewport measurements because report CSP intentionally denies frames. Screenshots desktop1440 and mobile375 inspected; long escaped pointers reflow. Actual keyboard Tab/Enter opens summary, focus3px; accessibility tree inspected and axe4.12.1 reports0 violations/0 incomplete (closed25 passes, expanded27). Console empty; browser resource count0 and no external/script/image/link/frame nodes. Browser behavior confirmed stylesheet CSP hash works. No Safari/real devices/VoiceOver pass claimed; these remain manual/platform coverage limits.

Disposable evidence directory /var/folders/9l/jsy6rgt160v3z3vrkqqjhdyh0000gn/T/statham-html-review-a9fh3fth contains only synthetic artifacts/screenshots/measurements.json. No real user input used or modified.

Security/standards independent reviewer reran5 CLI tests PASS, no blocker. Spec reviewer pending; exact-head CI/integration pending. R1/R2 mitigated by escape/privacy/CSP tests plus actual browser no-resource checks; R3 baseline semantics covered; R4 worker/byte limit regression; R5 measured layout/contrast/keyboard/axe mitigations. No known high/critical implementation defect. E VERIFYING, F TODO.

## Technical closure — 2026-10-30

A–F DONE with evidence: full82 tests/pre-commit/pack PASS; browser measurements above; independent security and spec reviews PASS. Spec reviewer also confirmed true mixed partial waiver (1 active,1 accepted, exit3) and bounded shared-prefix schemas fail closed with small error view/empty stderr. No claim of exhaustive maximal amplification or global parent heap cap;1MiB is the published artifact bound.

All10 exact-head55bbc33dc4e4b5fb4b7ba2f1f3ec459cddabc1f4 push/PR checks PASS: https://github.com/memolabs-dev/json-statham/actions/runs/41085302672 and https://github.com/memolabs-dev/json-statham/actions/runs/41085279962. Real Action, installed package and Linux/macOS Node22/24 included. PR22 MERGED as1bdc4e7deaebf11c48512b6f749f456cc643f118; technical issue20 actually CLOSED completed, verified directly. Human acceptance21 OPEN. R1–R5 mitigated within stated scope; no known high/critical open risk. Status READY_FOR_MANUAL_ACCEPTANCE. Branches retained, no deployment/npm registry release, no user-data migration. README contains local save/open recipe.

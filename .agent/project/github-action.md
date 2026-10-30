# GitHub Action — M1 slice (T2)

Scope: reusable Linux composite Action for existing validation/comparison. No PR comment, token or write permission; GitHub workflow annotations only. Not all of M1.

Domain: a contract check is either validation of one document or comparison of two contract versions. An annotation is a diagnostic displayed by GitHub, retaining its JSON Pointer; no invented line mapping.

Requirements / acceptance:

- GA-1: validate(schema, document) and compare(old-schema, new-schema) invoke the real CLI, keep exit codes 0/1/2/3 and publish status + exit-code. Report JSON logged on one line; no artwork or raw payload values.
- GA-2: rejected checks emit error annotations tied to document (validation) or new schema (comparison). Escape workflow command data and properties; cap annotations at 50, explain truncation.
- GA-3: all inputs cross the shell boundary via environment variables; no shell execution by runner. Invalid mode/missing inputs or runtime failures fail closed with exit 2. Five-second CLI worker deadline plus an eight-second parent deadline; child output capped at 1 MiB.
- GA-4: install/build only Action-owned code; pinned setup-node; no consumer lifecycle scripts. Linux runtime, Node 24. CI executes the actual composite with valid, rejected and comparison fixtures and checks outputs.
- GA-5: full pre-commit/CI, documentation, independent review; separate human acceptance.

Work graph: A model/spec → B runner validation → C rejection + annotation safety → D compare/errors → E composite + real CI smoke + docs → F review, green CI, merge, tracker reconciliation.
Verification: approved seams core, CLI, Action process (real temp output files); focused red/green per behavior, npm run check, actual GitHub composite job.
Risks: workflow injection through property names/path handled with escaping. Input-controlled strings never interpolated into shell commands. No payload logs beyond existing sanitized CLI reports. Resource output bound may reject very large reports with input error; explicit limit. Network needed only to install/build Action dependencies; evaluation stays offline. File annotations identify the file; JSON Pointer is in message, line mapping out of scope. Independent review pending.
Status: IMPLEMENTING. Evidence pending. Manual acceptance: try documented validation/comparison workflow in a consuming repository; confirm check visibility and annotations.

Local evidence: focused vertical red/green cycles captured missing launcher, missing rejection annotations, unsafe command escaping (4 lines instead of 2), missing comparison argument selection, unhandled output-file failure, unbounded annotations and missing runtime-failure outputs. Each corrected with minimal code before the next behavior. The oversized-report fixture exercises the actual CLI, not a mocked child. Initial full check PASS (23 tests); final expanded checks and remote composite execution pending.

Expanded local verification: `npm run check` PASS (26 tests; 9 Action process tests, 7 CLI tests, 10 core tests). `npm pack --dry-run` PASS; `git diff --check` PASS. Actual composite CI and independent review remain pending.

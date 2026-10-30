# JSON Statham

Your JSON has met its match.

Deterministic JSON Schema validation and conservative contract comparison. No AI or network access is required. Inputs are never modified.

## Install from source

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run build
npm link
```

## Terminal portrait

Run `json-statham --help` (or `-h`) to see the original ASCII caricature inspired by Jason Statham and command help. Running without arguments shows the same screen with usage exit code 2. The monochrome portrait needs no color support or special fonts. Validation, comparison and `--json` reports keep their usual output.

```sh
node dist/cli.js --help
```

## Validate

```sh
json-statham validate examples/schema.json examples/valid.json
json-statham validate examples/schema.json examples/invalid.json --json
```

Validation uses Ajv in strict mode with JSON Schema Draft 2020-12. Local references are supported. Unresolved external references, unknown keywords, unsupported formats and asynchronous schemas are rejected.

## Compare contracts

```sh
json-statham compare examples/schema.json examples/next-schema.json --json
```

The direction is old → new: could a previously accepted document now be rejected? Changed constraints produce schema JSON Pointers and remediation guidance. When available, `counterexample` contains a synthetic value verified against both schemas. For example, adding `minLength: 1` to a string contract produces the counterexample `""`.

Comparison is deliberately conservative: every structural change is flagged, including annotations and compatible relaxations. Identical schemas (ignoring object key order) return `unchanged`. It does not prove semantic compatibility, resolve references for comparison, or guarantee a counterexample for every finding.

## Reports and exit codes

`--json` emits a single JSON report with `status`, `diagnostics` and an optional `counterexample`. Each diagnostic has `code`, `path` (JSON Pointer) and `message`. Human reports show status and diagnostics. Diagnostics omit document values; pointers may contain property names.

| Exit | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Valid document, unchanged schemas or accepted baseline |
| 1    | Document rejected by schema                            |
| 2    | Usage, JSON, schema, file or resource error            |
| 3    | Potentially breaking contract change                   |

## Limits and security

CLI inputs must be regular files no larger than 1 MiB, with nesting at most 64. Evaluation runs in a worker with a five-second deadline and a 128 MiB old-generation heap limit. Error reports redact underlying parser and compiler details. The reusable core (`dist/core.js`) exposes `validate` and `compare`; callers must provide their own resource isolation for untrusted inputs.

## Develop

```sh
npm run check
npm pack --dry-run
```

Checks include formatting, lint, TypeScript, unit/integration tests and real CLI tests. GitHub Actions runs these checks on Node.js 22 and 24.

## GitHub Action (M1 preview)

On Linux GitHub-hosted runners, check out your repository and invoke this repository as an Action. Pin the Action to a reviewed commit SHA (no version tag is published yet). Only `contents: read` is needed; it never posts PR comments or uses a write token.

```yaml
permissions:
  contents: read
jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: memolabs-dev/json-statham@2848932b9d3f321372d4d06f78d017043fa0dd4f
        with:
          schema: contracts/request.schema.json
          document: fixtures/request.json
```

For comparison, set `command: compare`, `old-schema` and `new-schema`. The direction is old → new. Paths refer to files in the checked-out workspace. The default command is `validate`; both its `schema`/`document` inputs (or both comparison inputs) must be provided.

The step fails for invalid documents, input/resource errors or potential breakage. Outputs `status` and `exit-code` retain CLI meanings. To inspect outputs after an expected failure, give the Action step an `id` and `continue-on-error: true`, then read `steps.<id>.outputs.status` and `steps.<id>.outputs.exit-code`; this opts out of blocking the workflow and should only be used deliberately.

The first check log line is the complete JSON report; subsequent lines are GitHub error annotations. Annotations identify the document or new-schema file and include the JSON Pointer in their message; they do not claim an exact source line. At most 50 diagnostic annotations are emitted, with a notice if more exist; the JSON report retains all findings. The Action additionally rejects CLI output above 1 MiB or a child process exceeding eight seconds. The CLI's five-second evaluation deadline still applies.

The Action sets up Node 24, installs its own locked development dependencies with lifecycle scripts disabled, and builds its CLI. This requires npm registry access during setup. Contract evaluation never resolves network references. No consumer install scripts are run. A stable library API remains a future M1 slice.

## Review and accept a comparison baseline

Baselines record explicit acceptance of diagnostics; they do not prove compatibility. First review the normal comparison and its implications for callers. Generate the baseline only after deciding to accept those findings:

```sh
json-statham compare examples/schema.json examples/next-schema.json --json
json-statham baseline examples/schema.json examples/next-schema.json > accepted-baseline.json
json-statham compare examples/schema.json examples/next-schema.json --baseline accepted-baseline.json --json
```

Generation emits versioned JSON to stdout and never writes files itself. If the generated artifact would exceed the 1 MiB loading limit, generation fails with exit 2 and an explicit diagnostic. Shell redirection above explicitly creates the file; it will overwrite an existing destination, so choose it deliberately. Commit and review baseline files under your repository's usual change controls. Baselines contain SHA-256 identities, not schemas or payload values. They are not signed authorization records.

A matching baseline changes fully accepted comparisons to `status: accepted`, exit 0. Reports retain `acceptedDiagnostics`, any still-active `diagnostics`, the synthetic counterexample when available, and `baseline: {stale, accepted}`. Removing entries from the baseline's `accepted` list permits partial acceptance; remaining findings retain exit 3. Unknown IDs grant no acceptance. An accepted comparison remains a potentially breaking contract whose findings you have waived.

Any change to either schema (including annotation or array-order changes) makes the baseline stale: nothing is accepted, active findings retain exit 3, and human/JSON output identifies the stale baseline. Object-key reordering alone is ignored. Regenerate only after reviewing the new comparison. Unsupported/malformed baselines, missing files and inputs over the CLI limits return exit 2; validation does not support baselines.

For the GitHub Action, add `baseline: path/to/accepted-baseline.json` alongside `command: compare`, `old-schema` and `new-schema`. Accepted comparisons publish `status: accepted` and `exit-code: 0`, while accepted diagnostics remain visible in the JSON log report. Stale comparisons retain the usual blocking annotations.

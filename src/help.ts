// Original ASCII caricature: bald head, heavy brow and close-cropped stubble.
const portrait = String.raw`
             .-::::::::-.
           .'            '.
          /                \
         /                  \
        |                    |
        |                    |
        |   __        __     |
       (|  /__\      /__\   |)
        |   -o-  /\  -o-    |
        |       /  \        |
        |      /_  _\       |
        |  . .   ||   . .   |
         \ : . .----. . :  /
          \ : '------' :  /
           \.:.:....:.:../
            '::......::'
             |::::::::|
          ___|        |___
       .-'    \______/    '-.

            JSON STATHAM
     Your JSON has met its match.
`;

export function renderHelp(): string {
  return `${portrait}
Usage:
  json-statham validate <schema> <document> [--json]
  json-statham compare <old-schema> <new-schema> [--json] [--baseline file]
  json-statham baseline <old-schema> <new-schema> [--json]
  json-statham plan <old-schema> <new-schema> --operations <patch-file>
  json-statham dry-run <old-schema> <new-schema> --document <file> --plan <file> [--json [--include-result]]
  json-statham stage <old-schema> <new-schema> --document <file> --plan <file> --transaction <new-dir> --output <new-file> [--json]
  json-statham apply --transaction <dir> --document <source> --output <new-file> [--json]
  json-statham restore --transaction <dir> --document <migrated> --output <new-file> [--json]
  json-statham inspect-transaction --transaction <dir> [--json]
  json-statham --help

  --json     Emit one machine-readable report without artwork.
  --baseline Accept reviewed findings for an exact comparison (compare only).
  --include-result Export candidate and rollback values (dry-run with --json).
  --transaction Private durable snapshot directory (stage creates a new one).
  --output   Explicit new file; existing destinations are never overwritten.
  -h, --help Show this help.

Exit codes: 0 success, 1 invalid/rejected document, 2 input/usage error,
            3 potentially breaking contract.
`;
}

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
  json-statham --help

  --json     Emit one machine-readable report without artwork.
  --baseline Accept reviewed findings for an exact comparison (compare only).
  -h, --help Show this help.

Exit codes: 0 success, 1 invalid document, 2 input/usage error,
            3 potentially breaking contract.
`;
}

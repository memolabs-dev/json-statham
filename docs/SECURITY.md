# Security

Inputs are untrusted. No network resolution by default. Limit size, nesting, recursion and runtime. Never execute payload content. Redact sensitive values. Never send input to AI without explicit consent. Use least-privilege CI permissions.

## Persistent file versions

Transactions retain sensitive full byte snapshots; summaries redact values, paths remain visible. Use caller-owned private local storage, retain backups deliberately, and review operations for business intent. Stage captures strict bounded regular files without following final symlinks and checks trusted ancestry, ownership and no group/world writes. Darwin grant ACLs are rejected by bounded shell-free native ACL inspection. Linux permission checks include the POSIX ACL mask.

Fixed artifact names, strict manifests, raw digests and retained publication inode identity reject corruption/rebinding. Same-filesystem no-replace hardlinks publish only new outputs. Immutable backups are separate from writable publication payloads. A worker replays schema/plan/rollback proof with 5s/128MiB limits before publication. File and directory sync ordering covers retries after interruption; immutable markers/intents avoid stale locks. Required filesystem-operation failures, unsafe path permissions and unsupported platforms fail closed. Supported local storage is a caller precondition; filesystem locality/type is not automatically detected. Root/malicious same-user changes and storage lying about durability are outside the boundary. See README recovery commands; no automatic cleanup, in-place overwrite or ACL/xattr cloning is provided.

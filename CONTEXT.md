# JSON Contract Compatibility

Detect whether an evolving input contract may reject previously accepted documents.

## Language

**Contract**: The set of JSON documents accepted by a schema.
_Avoid_: format, payload

**Validation**: Determining whether one document belongs to a contract.

**Breaking change**: A contract evolution that rejects at least one previously accepted document.
_Avoid_: schema difference

**Potential breaking change**: A changed constraint whose safety has not been proved; it may be compatible.

**Counterexample**: A synthetic document accepted by the old contract and rejected by the new contract.
_Avoid_: sample payload, proof of compatibility

**Diagnostic**: An actionable explanation located at a document or schema JSON Pointer, without revealing input values.

**Contract check**: A validation or comparison evaluated as one acceptance gate.

**Annotation**: A diagnostic attached to a file in a development platform, retaining its contract location.

**Baseline**: A versioned record of explicitly accepted diagnostics for one exact old-to-new contract pair. It does not assert compatibility.

**Accepted diagnostic**: A potential breaking change explicitly included in a matching baseline, retained for review but excluded from the failure gate.

**Stale baseline**: A baseline whose contract pair no longer matches the comparison; it grants no acceptance.

**Migration plan**: A proposal binding explicitly chosen document operations to one exact pair of source and target contracts.

**Dry-run**: A migration simulated on copies, with its outcome checked before any persistent change.

**Verified repair**: A simulated document accepted by the target contract, with a rollback verified to restore the exact source document.

**Rollback snapshot**: A private copy of a source document represented as a root-replacement operation for restoration.

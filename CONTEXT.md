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

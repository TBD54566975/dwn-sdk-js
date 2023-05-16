
# DWN Q&A

## Message ID (`messageCid`) and Record ID (`recordId`)

- Why can't/don't we use the message ID (`messageCid`) of the initial `RecordsWrite` as the record ID?

  Because the initial `RecordsWrite` references the record ID in multiple places, so this would be a "chicken-and-egg" problem:
  1. `recordId` property contains the record ID
  1. If the initial `RecordsWrite` is for a root record in a DWN protocol, the record ID is the value of the `contextId` property
  1. If the initial `RecordsWrite` is encrypted, the record ID is used in the final segment of the key derivation path

  Because of the above constraints, we had to introduce a different algorithm (a.k.a as `entryId` generation) to deterministically compute the `recordId`.

  See question [why is `recordId` needed in the `RecordsWrite`](#why-is-record-id-needed) for more info.

- Why is `recordId` required in a `RecordsWrite`?

  This question should be further split into two:
  1. Why is `recordId` required in an initial `RecordsWrite` (create)?
  1. Why is `recordId` required in a subsequent `RecordsWrite` (update)?

  The latter question is much easier to answer: an update needs to reference the record that it is updating.

  The answer to the first-part question is more complicated: `recordId` technically is not needed in an initial `RecordsWrite`, but we chose to include it for data model consistency with subsequent `RecordsWrite`, such that we can simply return the latest message of a record as the response to `RecordsRead` and `RecordsQuery` (for the most part, we still remove `authorization`) without needing to re-inject/rehydrate `recordId` into any initial `RecordsWrite`. It is also the same reason why `contextId` is required for the initial `RecordsWrite` of a protocol-authorized record.
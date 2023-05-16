
# DWN Q&A

## Message ID (`messageCid`) and Record ID (`recordId`)

- Why can't/don't we use the message ID (`messageCid`) of the initial `RecordsWrite` as the record ID?

  Because the initial `RecordsWrite` contains the `recordId` property, so this would be a "chicken-and-egg" problem. See question [why is `recordId` needed in the `RecordsWrite`](#why-is-record-id-needed) for more info.

- Why is `recordId` needed in a `RecordsWrite`?

  This question should be further split into two:
  1. Why is `recordId` needed in an initial `RecordsWrite` (create)?
  1. Why is `recordId` needed in a subsequent `RecordsWrite` (update)?

  The latter question is much easier to answer: an update needs to reference the record that it is updating.

  The answer to the first-part question is more complicated, `recordId` technically is not needed in an initial `RecordsWrite`, but we chose to include it for data model consistency with subsequent `RecordsWrite`. See [can `recordId` be excluded in initial `RecordsWrite`](#can-record-id-be-excluded) for further explanation.
  
- Technically, can `recordId` be excluded in initial `RecordsWrite` therefore allow a design where the message CID of the initial `RecordsWrite` is the record ID? <span id="record-">can-record-id-be-excluded</span>

  Yes, this is technically viable. 

  The decision to require `recordId` for initial `RecordsWrite` is purely for consistency: so that we can simply return the latest message of a record as the response to `RecordsRead` and `RecordsQuery` (for the most part, because we still remove `authorization`), without needing to re-inject/rehydrate `recordId` into any initial `RecordsWrite`. Because of this design choice, we had to introduce a different algorithm (a.k.a as `entryId` generation) to deterministically compute the `recordId`. It is debatable if this is a "good" tradeoff.
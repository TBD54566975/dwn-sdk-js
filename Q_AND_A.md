
# DWN Q&A

## Message ID (`messageCid`) and Record ID (`recordId`)

- Why can't/don't we use the message ID (`messageCid`) of the initial `RecordsWrite` as the record ID?

  (Last updated: 2023/05/16)

  Because the initial `RecordsWrite` references the record ID in multiple places, so this would be a "chicken-and-egg" problem:
  1. `recordId` property contains the record ID
  1. If the initial `RecordsWrite` is for a root record in a DWN protocol, the record ID is the value of the `contextId` property
  1. If the initial `RecordsWrite` is encrypted, the record ID is used in the final segment of the key derivation path

  Because of the above constraints, we had to introduce a different algorithm (a.k.a as `entryId` generation) to deterministically compute the `recordId`.

  See question [why is `recordId` needed in the `RecordsWrite`](#why-is-record-id-needed) for more info.

- Why is `recordId` required in a `RecordsWrite`?

  (Last updated: 2023/05/16)

  This question should be further split into two:
  1. Why is `recordId` required in an initial `RecordsWrite` (create)?
  1. Why is `recordId` required in a subsequent `RecordsWrite` (update)?

  The latter question is much easier to answer: an update needs to reference the record that it is updating.

  The answer to the first-part question is more complicated: `recordId` technically is not needed in an initial `RecordsWrite`, but we chose to include it for data model consistency with subsequent `RecordsWrite`, such that we can simply return the latest message of a record as the response to `RecordsRead` and `RecordsQuery` (for the most part, we still remove `authorization`) without needing to re-inject/rehydrate `recordId` into any initial `RecordsWrite`. It is also the same reason why `contextId` is required for the initial `RecordsWrite` of a protocol-authorized record.


## Encryption

- Why is `publicKeyId` required in `KeyEncryptionInput`?

  (Last updated: 2023/05/19)

  It is required because the ID of the public key (more precisely the ID of the asymmetric key pair) used to encrypt the symmetric key will need to be embedded as metadata (named `rootKeyId`), so that when a derived private key (which also contains the key ID) is given to the SDK to decrypt an encrypted record, the SDK is able to select the correct encrypted key for decryption. This is useful because if there are multiple encrypted keys attached to the record, the correct encrypted key will be selected immediately without the code needing to trial-and-error on every key until a correct key is found.
  
  Even if there is only one encrypted key attached to the encrypted record, there is no guarantee that the private key given is the correct corresponding private key, so it is still important to have the key ID so that the code can immediately reject the given private key if the ID does not match. There are a number of cases why a key ID mismatch can occur:

  1. The DWN owner might have published multiple encryption keys, and a wrong encryption key is chosen.
  1. The key used to encrypt the record might not be the DWN owner's key at all. For instance, a sender's encryption key is used instead.

- Instead of introducing yet another property `publicKeyId` in `KeyEncryptionInput`, why do we not just use the `kid` property in the public JWK?

  (Last updated: 2023/05/19)

  This is because:
  1. `kid` is an optional property of a JWK, there is no guarantee that the public JWK will contain it.
  2. In the future public key may not always be given in JWK format. A key in raw bytes does not contain metadata such as key ID.


## Pagination
- Why is `messageCid` mandated as the cursor for pagination?

  (Last updated: 2023/09/12)

  The requirement for using `messageCid` as the cursor for pagination aims to ensure compatibility across different DWN store implementations. The goal is for a query using the same cursor to yield identical results, regardless of which DWN is handling the query. This is useful because, if a DWN becomes unavailable after delivering a page of messages, user can switch to another DWN and resume fetching following pages without any interruption.


## Protocol
- Can a record that is not protocol-authorized have `protocol` property in its `descriptor`?

  (Last updated: 2023/05/23)

  No.

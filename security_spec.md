# Security Specification for DSSG Success Portal

## 1. Data Invariants
- A Business document must specify an `ownerId` matching the creator's `request.auth.uid`.
- An Engagement document must reference an existing Business and have an `ownerId` matching the creator.
- Users can only read and write their own Business and Engagement documents.
- The `role` field in a User document is immutable by the client once set (or default to 'client').
- Timestamps must be validated against `request.time`.

## 2. The Dirty Dozen (Attack Vectors)
1. **Identity Spoofing**: Attempt to create a Business with someone else's `ownerId`.
2. **Resource Hijacking**: Attempt to read/update an Engagement document owned by another user.
3. **Privilege Escalation**: Attempt to update own User document to change `role: "client"` to `role: "admin"`.
4. **Shadow Field Injection**: Adding an `isVerified: true` field to a Business document.
5. **Orphaned Engagement**: Creating an Engagement for a non-existent Business ID.
6. **Timeline Bypass**: Skipping stages in the engagement lifecycle (though status updates are allowed, the lifecycle is tracked).
7. **Resource Exhaustion**: Sending a 1MB string as a Business name.
8. **Malicious ID**: Using a very long or special-character string as a document ID.
9. **PII Leak**: Attempting to list all User documents to scrape emails.
10. **State Corruption**: Updating a 'completed' engagement back to 'pending' (Terminal state check).
11. **Timestamp Forgery**: Sending a client-side `updatedAt` far in the past/future.
12. **Unverified Account Write**: Writing data with an unverified email (if email_verified is required).

## 3. Test Runner (Draft Plan)
A test file `firestore.rules.test.ts` will verify these rejections.

# RaktSetu Security Rules Specification

## Data Invariants
1. User accounts (`/users/{userId}`) contain PII (`email`) and may only be read, created, or updated by the verified owning user (`request.auth.uid == userId`).
2. User medical screening records (`/users/{userId}/screenings/{screeningId}`) and AI health chat logs (`/users/{userId}/healthChats/{messageId}`) are strictly private and immutable after creation.
3. Public anonymized donor pins (`/donors/{donorId}`) never contain PII, require authenticated verified users to publish, enforce `ownerUid == request.auth.uid`, and validate strict bounds and allowlisted keys.
4. All server timestamps (`createdAt`, `updatedAt`) must equal `request.time`.
5. All document IDs must match `^[a-zA-Z0-9_\-]+$` and be at most 128 characters.

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/uid1`.
2. User `uid2` attempting to read `/users/uid1` (PII leak).
3. User `uid1` creating `/users/uid1` with an extra shadow field `isAdmin: true`.
4. User `uid1` updating `uid` or `createdAt` on `/users/uid1`.
5. User `uid1` writing `/users/uid1` with `role: "superadmin"` (invalid enum).
6. User `uid1` creating `/users/uid1` with `displayName` exceeding 64 characters.
7. User `uid2` attempting to list `/users/uid1/screenings`.
8. User `uid1` attempting to update/tamper with an already submitted `/users/uid1/screenings/scr1`.
9. User `uid1` creating `/users/uid1/screenings/scr1` with `userId: "uid2"` (identity spoofing).
10. User `uid1` creating `/users/uid1/healthChats/msg1` with forged `createdAt` timestamp instead of `request.time`.
11. User `uid1` creating `/donors/bad..id` (invalid path ID poisoning).
12. User `uid2` attempting to delete `/donors/donor1` owned by `uid1`.

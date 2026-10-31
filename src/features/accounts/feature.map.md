# Accounts

## Capability

Owns account creation, sign-in, and session lifecycle. Persist account identities and protected provider credentials through src/db. Verification covers rejected credentials, session expiry, and access isolation.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

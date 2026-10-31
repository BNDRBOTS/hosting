# Projects

## Capability

Owns connecting GitHub projects and listing projects available to an account. Verification covers connection, removal, and account-level access boundaries.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

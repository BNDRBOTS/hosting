# System Health

## Capability

Owns the plain-English /status page and the internal health response. User-visible failures contain no raw errors or developer codes.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

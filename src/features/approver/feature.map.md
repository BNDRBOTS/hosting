# Approver

## Capability

Owns independent evidence review in a fresh execution context. Approval requires complete requirement coverage, evidence-backed claims, non-empty artifacts, and an independent passing spot-check on the same code version.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

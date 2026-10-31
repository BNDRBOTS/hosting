# History

## Capability

Owns the readable record of requests, checks, decisions, shipped outcomes, reversion, and undo. It presents plain-English results without exposing developer terminology.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

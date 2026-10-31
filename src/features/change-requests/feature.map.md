# Change Requests

## Capability

Owns plain-English change intake and testable requirement records. Verification covers preserving the original request and mapping each requirement to an assertion.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

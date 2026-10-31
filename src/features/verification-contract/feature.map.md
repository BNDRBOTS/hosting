# Verification Contract

## Capability

Owns detection and setup of a project verification suite. A suite is not accepted until its known-good behavior is independently checked. Verification covers detection and invalid-suite rejection.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

# Shipping

## Capability

Owns the automatic ship gate and plain-English outcome notifications. Shipping requires passing final-version verification and an evidence-validated independent approval; no human gate is permitted.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

# Agent Runs

## Capability

Owns isolated implementation attempts, progress records, and the bounded evidence-fed repair loop. Verification covers attempt limits and automatic rejection after exhaustion.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

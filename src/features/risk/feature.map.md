# Risk

## Capability

Owns deterministic change risk classification. Authentication, payments, user-data deletion, migrations, more than ten files, or more than four hundred changed lines are high risk. Classification uses no model judgment.

## Ownership

This feature owns its components, actions, schemas, and queries. It may import shared infrastructure from `src/lib` and `src/db`; it must not import another feature.

## Verification

Feature checks must exercise the externally observable behavior and retain machine-readable evidence. A feature may not claim success without passing assertions tied to the exact tested code version.

# ProofLoop verification

The repository verification command is `make verify`. It builds the application, runs ESLint (including the feature import-boundary rule), and runs the Node test suite. `make verify-flow FLOW=<name>` currently runs that same complete suite for every flow name. The dedicated verification CLI and browser evidence capture are introduced in the later verification-engine phase.

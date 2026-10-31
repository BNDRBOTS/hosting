# ProofLoop

ProofLoop is a web application that checks requested software changes against evidence before they can ship. This repository contains the feature-first application foundation and the initial deterministic risk rules, encrypted-secret utility, database schema, and local developer environment.

## Local development

Requirements: Node.js 22 and Docker Compose.

```sh
corepack pnpm install
cp .env.example .env
# Set PROOFLOOP_MASTER_KEY and all eight different role keys in .env.
make up
make migrate
make dev
```

The app is available at `http://localhost:3000`; its readiness response is at `/api/health`, and its plain-English status page is at `/status`.

## Checks

```sh
make test
make verify
make verify-flow FLOW=<name>
make audit
```

`make verify-flow` currently runs the same complete build, lint, and test suite as `make verify`. The dedicated browser-evidence verification CLI and the automatic change pipeline are added in their later implementation phases.

The local fixture seed is restricted to `NODE_ENV=test` and inserts only an account, a connected-project record, and a queued request with a testable requirement. It does not manufacture passing verification evidence or approval records.

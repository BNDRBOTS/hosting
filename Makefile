.PHONY: up down migrate seed dev test verify verify-flow audit

up:
	docker compose up -d --wait

down:
	docker compose down

migrate:
	corepack pnpm db:migrate

seed:
	NODE_ENV=test corepack pnpm db:seed

dev:
	mkdir -p .proofloop/evidence
	corepack pnpm dev

test:
	corepack pnpm test

verify:
	corepack pnpm build
	corepack pnpm lint
	corepack pnpm test

verify-flow:
	@test -n "$(FLOW)" || { echo 'Provide FLOW=<name>.'; exit 2; }
	corepack pnpm build
	corepack pnpm lint
	corepack pnpm test

audit:
	node scripts/p8.1-audit.mjs

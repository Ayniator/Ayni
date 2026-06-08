.PHONY: setup build test clean

setup:   ## Install Rust + Solana CLI + Anchor + JS deps (idempotent)
	./scripts/setup.sh

build:   ## anchor build
	./scripts/build.sh

test:    ## anchor test (no-ZK suites against a local validator)
	./scripts/test.sh

clean:
	anchor clean || true
	rm -rf .anchor test-ledger target/deploy

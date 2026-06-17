BUMP ?= patch

.PHONY: check build test lint format clean publish install bump-version help

help:
	@echo "Available targets:"
	@echo "  make install    - Install dependencies"
	@echo "  make check      - Run typecheck and lint"
	@echo "  make build      - Build the project"
	@echo "  make test       - Run tests"
	@echo "  make lint       - Run Biome linter"
	@echo "  make format     - Format code with Biome"
	@echo "  make clean      - Remove build artifacts"
	@echo "  make bump-version [BUMP=patch|minor|major|x.y.z] - Bump package version without tagging"
	@echo "  make publish    - Publish to npm"

install:
	bun install

check: lint typecheck

typecheck:
	bun run typecheck

lint:
	bunx biome check .

format:
	bunx biome format . --write

build:
	bun run build

test:
	bun test ./__tests__/

clean:
	rm -rf dist

bump-version:
	npm version $(BUMP) --no-git-tag-version

publish: clean build test
	npm publish

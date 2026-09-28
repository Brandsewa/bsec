# ADR-009: Versioned block registry

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §2 (Content), §5.9, §17

## Context
Merchants build home and landing pages from sections (Hero, ProductGrid, FAQ, …). Page documents are stored as JSON and live for years; the components that render them will change. A schema change must never break a live store.

## Decision
`packages/blocks` (created in M2) is a registry of block types. Each type has a `version`, a Zod/JSON schema, a React renderer and migration functions from earlier versions. Page documents store `{ id, type, version, props }`. Blocks are validated on save **and** on render; old versions are migrated on read and by a backfill job. `block_definitions` mirrors the registry for platform tooling. Pages are versioned (`page_versions`); publishing points `published_version_id`, rollback points it back. V1 edits via forms and section ordering; the Puck visual editor comes later on the same registry.

## Consequences
- Breaking a block requires a new version plus a migration, with tests.
- No HTML in props except sanitized rich text.

## Alternatives considered
- **Unversioned JSON:** silent breakage on every component change.
- **Merchant-authored templates (Liquid/JSX):** see ADR-010.

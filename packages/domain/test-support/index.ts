/**
 * Test helpers for packages that must not import @bs/db themselves (hard rule 2) but test against a real database:
 * the capability layer and its adapters. Only tests import this entry.
 */
export { startTestDb, type TestDb } from "@bs/db/test-env";

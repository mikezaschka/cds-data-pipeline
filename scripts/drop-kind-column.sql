-- SQLite migration: drop the `kind` column from plugin_data_pipeline_Pipelines.
--
-- Run this against existing consumer databases that were deployed before
-- `kind` was removed from db/index.cds. The column is no longer read or
-- written by the engine; keeping it around is harmless but leaves a dead
-- column in the tracker schema.
--
-- Safe to re-run: if `kind` has already been dropped, the ALTER is a
-- no-op and SQLite returns an error that the surrounding wrapper
-- script (or a human) can ignore.
--
-- HANA HDI: do NOT use this script. HANA schema transitions are owned
-- by the HDI deployer — rebuild your CDS model and redeploy (`cf push`
-- / HDI deploy) so the deployer drops the column on diff.
--
-- Usage:
--   sqlite3 <path/to/db.sqlite> < scripts/drop-kind-column.sql

ALTER TABLE plugin_data_pipeline_Pipelines DROP COLUMN kind;

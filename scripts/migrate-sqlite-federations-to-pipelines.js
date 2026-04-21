#!/usr/bin/env node
/*
 * One-shot SQLite migration from pre-ADR-0005 tracker tables to the new
 * cds-data-pipeline tables.
 *
 *   plugin_data_federation_Federations      -> plugin_data_pipeline_Pipelines  (+ kind column)
 *   plugin_data_federation_ReplicationRuns  -> plugin_data_pipeline_PipelineRuns
 *   tracker_name (FK on runs)               -> pipeline_name
 *   strategy column (if present)            -> dropped
 *
 * HANA HDI: do NOT use this script. HANA schema transitions are owned by the
 * HDI deployer — rebuild your CDS model and redeploy (`cf push` / HDI deploy).
 * See ../../UPGRADE.md.
 *
 * Usage:
 *   node migrate-sqlite-federations-to-pipelines.js --url <path/to/db.sqlite> [--dry-run]
 *
 * Idempotent: if the new tables already exist and the old ones don't, the
 * script exits with a notice and no changes.
 */

'use strict'

const path = require('path')

const OLD_FED = 'plugin_data_federation_Federations'
const OLD_RUNS = 'plugin_data_federation_ReplicationRuns'
const NEW_PIPELINES = 'plugin_data_pipeline_Pipelines'
const NEW_RUNS = 'plugin_data_pipeline_PipelineRuns'

function parseArgs(argv) {
    const args = { dryRun: false, url: null }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--dry-run') args.dryRun = true
        else if (a === '--url' || a === '-u') args.url = argv[++i]
        else if (a === '--help' || a === '-h') args.help = true
    }
    return args
}

function usage() {
    console.log(`Usage: node ${path.basename(__filename)} --url <path/to/db.sqlite> [--dry-run]`)
    console.log('')
    console.log('Migrates pre-ADR-0005 SQLite tracker tables to cds-data-pipeline naming.')
    console.log('HANA HDI deployments should not use this script; redeploy via HDI instead.')
}

async function tableExists(db, name) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
            [name],
            (err, row) => (err ? reject(err) : resolve(!!row))
        )
    })
}

async function columnExists(db, table, column) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${table})`, (err, rows) => {
            if (err) return reject(err)
            resolve(rows.some(r => r.name === column))
        })
    })
}

function run(db, sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, (err) => (err ? reject(err) : resolve()))
    })
}

async function migrate({ url, dryRun }) {
    let sqlite3
    try {
        sqlite3 = require('sqlite3')
    } catch (err) {
        throw new Error(
            `sqlite3 is required to run this migration. Install it in the target project:\n` +
            `  npm install sqlite3 --no-save\nOriginal error: ${err.message}`
        )
    }

    const steps = []
    const exec = async (sql) => {
        steps.push(sql)
        if (!dryRun) await run(db, sql)
    }

    const db = new sqlite3.Database(url)

    try {
        const hasNewPipelines = await tableExists(db, NEW_PIPELINES)
        const hasNewRuns = await tableExists(db, NEW_RUNS)
        const hasOldFed = await tableExists(db, OLD_FED)
        const hasOldRuns = await tableExists(db, OLD_RUNS)

        if (hasNewPipelines && hasNewRuns && !hasOldFed && !hasOldRuns) {
            console.log(`Nothing to migrate — ${NEW_PIPELINES} / ${NEW_RUNS} already present and legacy tables absent.`)
            return
        }

        if (!hasOldFed && !hasOldRuns) {
            console.log(
                `No legacy tables found in ${url}. ` +
                `Run 'cds deploy' to create the new schema from scratch.`
            )
            return
        }

        await exec('BEGIN TRANSACTION')

        if (hasOldFed && !hasNewPipelines) {
            await exec(`ALTER TABLE ${OLD_FED} RENAME TO ${NEW_PIPELINES}`)
            if (!(await columnExists(db, NEW_PIPELINES, 'kind'))) {
                await exec(`ALTER TABLE ${NEW_PIPELINES} ADD COLUMN kind NVARCHAR(5000)`)
            }
            await exec(`UPDATE ${NEW_PIPELINES} SET kind = 'replicate' WHERE kind IS NULL`)
        }

        if (hasOldRuns && !hasNewRuns) {
            await exec(`ALTER TABLE ${OLD_RUNS} RENAME TO ${NEW_RUNS}`)
            if (await columnExists(db, NEW_RUNS, 'tracker_name')) {
                await exec(`ALTER TABLE ${NEW_RUNS} RENAME COLUMN tracker_name TO pipeline_name`)
            }
        }

        await exec('COMMIT')

        if (dryRun) {
            console.log('--- DRY RUN — planned SQL:')
            steps.forEach(s => console.log(s))
        } else {
            console.log(`Migration complete: ${steps.length} statement(s) applied.`)
        }
    } catch (err) {
        if (!dryRun) {
            await new Promise(r => db.run('ROLLBACK', () => r()))
        }
        throw err
    } finally {
        await new Promise(r => db.close(() => r()))
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    if (args.help || !args.url) {
        usage()
        process.exit(args.help ? 0 : 1)
    }
    try {
        await migrate(args)
    } catch (err) {
        console.error(`Migration failed: ${err.message}`)
        process.exit(1)
    }
}

if (require.main === module) main()

module.exports = { migrate }

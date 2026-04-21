const cds = require('@sap/cds')
const { createAdapter } = require('../adapters/factory')
const { createTargetAdapter } = require('../adapters/targets/factory')

const LOG = cds.log('cds-data-pipeline')
const PIPELINES = 'plugin_data_pipeline_Pipelines'
const RUNS = 'plugin_data_pipeline_PipelineRuns'

/**
 * Per-pipeline execution engine.
 *
 * Drives the READ -> MAP -> WRITE pipeline by constructing `cds.Request`
 * instances and dispatching them through the parent `DataPipelineService`.
 * Default per-phase handlers are registered on the parent service and invoked
 * via its internal router; user-facing hooks (`before.PIPELINE.MAP`,
 * `after.PIPELINE.WRITE`, ...) compose through CAP's native handler chain.
 */
class Pipeline {
    constructor(name, config, srv) {
        this.name = name
        this.config = config
        this.srv = srv
    }

    async init() {
        this.srv.registerDefault('PIPELINE.READ', this.name, (req) => this._defaultReadHandler(req))
        this.srv.registerDefault('PIPELINE.MAP', this.name, (req) => this._defaultMapHandler(req))
        this.srv.registerDefault('PIPELINE.WRITE', this.name, (req) => this._defaultWriteHandler(req))

        // Resolve the read adapter once at registration. Lets the service
        // compose an adapter-aware startup log line (ADR 0007
        // §"Observability compensation") and avoids re-doing the
        // `cds.connect.to(source.service)` lookup on every READ phase.
        // `cds.connect.to` returns an in-process service proxy; no network
        // traffic is issued until the first `.run()`.
        this.adapter = await createAdapter(this.config)

        // Target adapter is symmetric: one instance per pipeline, resolved
        // once, consulted by every WRITE-phase and pre-write path. The
        // default `DbTargetAdapter` lazily connects to 'db' so no network
        // / DB activity happens until the first batch lands.
        this.targetAdapter = await createTargetAdapter(this.config)

        // Capability-based validation (ADR-0007 rows 6-8) — must happen
        // after the target adapter is resolved and before any tracker
        // writes, so an incompatible config throws cleanly at
        // registration rather than halfway through the first run.
        if (typeof this.srv._validateTargetCapabilities === 'function') {
            this.srv._validateTargetCapabilities(this.config, this.targetAdapter)
        }

        // ADR 0008 — memoize multi-source state once. `origin` is the
        // label stamped into the target's `source` key column; the
        // aspect test recognizes consumers that mixed in
        // `plugin.data_pipeline.sourced` *and* consumers who declared a
        // `key source : String(N)` element directly (the element-level
        // shape is what matters at write time).
        this.origin = (this.config.source && this.config.source.origin) || null
        this.hasSourceAspect = this._targetHasSourceAspect()

        await this._ensureTracker()
        LOG._info && LOG.info(`Initialized pipeline: ${this.name}`)
    }

    /**
     * True when the target entity exposes a `source` element marked as a
     * primary key — the structural fingerprint of the
     * `plugin.data_pipeline.sourced` aspect (ADR 0008). Checks the
     * compiled CDS model rather than the aspect name so consumers who
     * declared `key source : String(100)` inline (without the import)
     * keep working.
     */
    _targetHasSourceAspect() {
        const entityName = this.config.target && this.config.target.entity
        const def = entityName && cds.model && cds.model.definitions && cds.model.definitions[entityName]
        const el = def && def.elements && def.elements.source
        return !!(el && el.key === true)
    }

    // ─── Execution ──────────────────────────────────────────────────────────────

    async execute(mode = 'delta', trigger = 'manual') {
        const affected = await UPDATE(PIPELINES)
            .set({ status: 'running' })
            .where({ name: this.name, status: { '!=': 'running' } })

        if (affected === 0) {
            LOG.warn(`Pipeline '${this.name}' already running, skipping.`)
            return
        }

        const runId = cds.utils.uuid()
        try {
            await INSERT.into(RUNS).entries({
                ID: runId,
                pipeline_name: this.name,
                status: 'running',
                startTime: new Date().toISOString(),
                trigger,
                mode,
                origin: this.origin || null,
                statistics_created: 0,
                statistics_updated: 0,
                statistics_deleted: 0,
            })

            const stats = mode === 'full'
                ? await this._fullSync()
                : await this._deltaSync()

            await UPDATE(RUNS).set({
                status: 'completed',
                endTime: new Date().toISOString(),
                statistics_created: stats.created,
                statistics_updated: stats.updated,
                statistics_deleted: stats.deleted,
            }).where({ ID: runId })

            await UPDATE(PIPELINES).set({
                status: 'idle',
                lastSync: new Date().toISOString(),
                statistics_created: { '+=': stats.created },
                statistics_updated: { '+=': stats.updated },
                statistics_deleted: { '+=': stats.deleted },
            }).where({ name: this.name })

        } catch (err) {
            LOG._error && LOG.error(`Pipeline failed for ${this.name}:`, err)

            if (runId) {
                await UPDATE(RUNS).set({
                    status: 'failed',
                    endTime: new Date().toISOString(),
                    error: JSON.stringify({ message: err.message }),
                }).where({ ID: runId })
            }

            await UPDATE(PIPELINES).set({
                status: 'failed',
                errorCount: { '+=': 1 },
                lastError: err.message,
            }).where({ name: this.name })

            throw err
        }
    }

    async _fullSync() {
        // Query-shape pipelines declare their refresh scope on the config
        // (`refresh: 'full'` wipes the target; `refresh: { mode: 'partial',
        // slice }` scopes the DELETE). `_prepareMaterializeTarget` runs
        // inside `_deltaSync` and honours that contract — an unconditional
        // wipe here would clobber rows outside the slice on a
        // partial-refresh pipeline.
        //
        // ADR 0008: when the target uses the `sourced` aspect and this
        // pipeline has an `origin` label, scope the pre-sync wipe to its
        // own origin so sibling pipelines' rows survive `mode: 'full'`.
        if (!this._isSnapshotWrite()) {
            await this._clearTargetForSync()
        }

        await UPDATE(PIPELINES)
            .set({ lastSync: null, lastKey: null })
            .where({ name: this.name })

        return this._deltaSync()
    }

    /**
     * Clear the target in preparation for a full re-sync. ADR 0008 scopes
     * the DELETE to `source = <origin>` when the target mixes in the
     * `sourced` aspect and this pipeline carries an origin label, so N
     * sibling pipelines can share one target table without wiping each
     * other out. Falls back to `truncate()` for legacy single-origin
     * targets.
     */
    async _clearTargetForSync() {
        if (this.hasSourceAspect && this.origin) {
            await this.targetAdapter.deleteSlice(this.config.target, { source: this.origin })
            LOG._info && LOG.info(
                `Pipeline '${this.name}': full-sync cleared target scope source='${this.origin}'`
            )
            return
        }
        await this.targetAdapter.truncate(this.config.target)
    }

    /**
     * True when this pipeline rebuilds the target from a query-shape read
     * (aggregated / derived snapshot). In that case the WRITE phase rebuilds
     * the target (full refresh → DELETE + INSERT; partial refresh → scoped
     * DELETE + INSERT) instead of UPSERTing row-by-row. Driven by the
     * presence of `source.query`, per ADR 0007 §"Inference rules".
     */
    _isSnapshotWrite() {
        return !!(this.config.source && this.config.source.query)
    }

    /**
     * JSON.stringify replacer that substitutes function values with a
     * marker string. Needed because `source.query` / `refresh.slice` are
     * closures on the live config object but the tracker row stores the
     * config as JSON. The marker preserves the fact that a closure was
     * supplied without exposing its body.
     */
    _safeReplacer(_key, value) {
        return typeof value === 'function' ? '[Function]' : value
    }

    async _deltaSync() {
        const stats = { created: 0, updated: 0, deleted: 0 }

        // ── READ phase ──
        const readReq = this._makeReq('PIPELINE.READ', {
            config: this.config,
            source: this.config.source,
            target: this.config.target,
        })
        await this.srv.dispatch(readReq)

        const sourceStream = readReq.data.sourceStream
        if (!sourceStream) {
            LOG.warn(`No source stream produced for '${this.name}'`)
            return stats
        }

        // ── Snapshot pre-write: clear the snapshot slice atomically with
        //    the subsequent INSERT batches via `cds.tx`. A crash after the
        //    tx rolls back leaves the previous snapshot intact (ADR 0007).
        const runBody = async () => {
            if (this._isSnapshotWrite()) {
                await this._prepareMaterializeTarget()
            }

            for await (const batch of sourceStream) {
                const mapReq = this._makeReq('PIPELINE.MAP', {
                    config: this.config,
                    source: this.config.source,
                    target: this.config.target,
                    sourceRecords: batch,
                    targetRecords: [],
                })
                await this.srv.dispatch(mapReq)

                const records = mapReq.data.targetRecords
                if (!records || records.length === 0) continue

                const writeReq = this._makeReq('PIPELINE.WRITE', {
                    config: this.config,
                    target: this.config.target,
                    targetRecords: records,
                    statistics: { created: 0, updated: 0, deleted: 0 },
                })
                await this.srv.dispatch(writeReq)

                const s = writeReq.data.statistics || {}
                stats.created += s.created || 0
                stats.updated += s.updated || 0
                stats.deleted += s.deleted || 0
            }
        }

        if (this._isSnapshotWrite()) {
            await cds.tx(runBody)
        } else {
            await runBody()
        }

        LOG._info && LOG.info(`Pipeline '${this.name}' processed ${stats.created} records`)
        return stats
    }

    /**
     * Clear the materialize target before the batch-insert loop.
     *
     * - `refresh: 'full'` (default): DELETE everything from the target entity.
     *   Not crash-safe beyond the surrounding tx — an aborted run rolls back
     *   and leaves the previous snapshot intact.
     * - `refresh` shaped as `{ mode: 'partial', slice }`: DELETE rows matching
     *   the slice predicate derived from the user-supplied closure. The slice
     *   predicate is mandatory — the adapter does not attempt to infer one
     *   from the source query's WHERE clause (it's not mechanically reliable
     *   across aggregates).
     */
    async _prepareMaterializeTarget() {
        const target = this.config.target
        const refresh = this.config.refresh

        if (refresh && typeof refresh === 'object' && refresh.mode === 'partial') {
            if (typeof refresh.slice !== 'function') {
                LOG.warn(
                    `Pipeline '${this.name}': refresh.mode='partial' requires refresh.slice(tracker). ` +
                    `Falling back to full refresh.`
                )
                await this.targetAdapter.truncate(target)
                return
            }
            const tracker = await this._getTracker()
            const predicate = await refresh.slice(tracker)
            await this.targetAdapter.deleteSlice(target, predicate)
            return
        }

        await this.targetAdapter.truncate(target)
    }

    /**
     * Construct a request for the pipeline. Sets `req.reply` before dispatch
     * to force interceptor-chain semantics on CAP's `on` handlers (without
     * it, CAP runs `on` handlers in parallel rather than as a chain with
     * `next()` fall-through). Path uses the plugin convention
     * `${srv.name}.${pipelineName}` so user-registered
     * `before/after(event, pipelineName, handler)` hooks match via CAP's
     * native path matcher.
     */
    _makeReq(event, data) {
        const req = new cds.Request({
            event,
            path: `${this.srv.name}.${this.name}`,
            data: { pipeline: this.name, ...data },
        })
        req.reply = (x) => { req.results = x }
        return req
    }

    // ─── Default handlers ───────────────────────────────────────────────────────

    async _defaultReadHandler(req) {
        const config = req.data.config || this.config
        const tracker = await this._getTracker()
        // Reuse the adapter resolved during `init()` when the caller ran
        // with the pipeline's own config (the common case). For callers
        // that override `req.data.config` we resolve a fresh adapter so
        // their override takes effect.
        const adapter = config === this.config ? this.adapter : await createAdapter(config)
        req.data.sourceStream = adapter.readStream(tracker)
    }

    async _defaultMapHandler(req) {
        const records = req.data.sourceRecords
        const config = req.data.config || this.config
        const viewMapping = config.viewMapping || { remoteToLocal: {} }
        const { remoteToLocal } = viewMapping
        const hasRenames = remoteToLocal && Object.keys(remoteToLocal).length > 0

        const mapped = hasRenames
            ? records.map(rec => {
                const out = {}
                for (const [key, val] of Object.entries(rec)) {
                    out[remoteToLocal[key] || key] = val
                }
                return out
            })
            : records.map(rec => ({ ...rec }))

        this._stampOrigin(mapped)
        req.data.targetRecords = mapped
    }

    async _defaultWriteHandler(req) {
        const records = req.data.targetRecords
        const config = req.data.config || this.config
        const target = req.data.target || config.target

        // ADR 0008 belt-and-braces: re-stamp `source = origin` right
        // before WRITE so a consumer-supplied `on('PIPELINE.MAP')` that
        // forgot the stamp still produces valid compound keys.
        this._stampOrigin(records)

        // Query-shape pipelines rebuild the (slice of the) snapshot from
        // scratch each run — `_prepareMaterializeTarget()` has already
        // cleared the target inside the pipeline's tx, so an INSERT is
        // both sufficient and correct. For entity-shape pipelines we keep
        // UPSERT for idempotency across re-runs (Req 4.4.4).
        const mode = (config.source && config.source.query) ? 'snapshot' : 'upsert'

        const stats = await this.targetAdapter.writeBatch(records, { mode, target })

        req.data.statistics = {
            created: (stats && stats.created) || 0,
            updated: (stats && stats.updated) || 0,
            deleted: (stats && stats.deleted) || 0,
        }
    }

    /**
     * Stamp `source = origin` on every record when this pipeline carries
     * an origin label and the target mixes in the `sourced` aspect
     * (ADR 0008). No-op for legacy single-origin pipelines.
     */
    _stampOrigin(records) {
        if (!this.hasSourceAspect || !this.origin || !records || records.length === 0) return
        for (const rec of records) {
            rec.source = this.origin
        }
    }

    // ─── Tracker management ─────────────────────────────────────────────────────

    async _ensureTracker() {
        const existing = await SELECT.one.from(PIPELINES).where({ name: this.name })
        if (!existing) {
            await INSERT.into(PIPELINES).entries({
                name: this.name,
                source: JSON.stringify(this.config.source, this._safeReplacer),
                target: JSON.stringify(this.config.target, this._safeReplacer),
                mode: this.config.mode,
                origin: this.origin || null,
                status: 'idle',
                errorCount: 0,
                statistics_created: 0,
                statistics_updated: 0,
                statistics_deleted: 0,
            })
        } else if (this.origin && existing.origin !== this.origin) {
            // Re-registrations that change origin (or set it for the first
            // time on a legacy tracker row) should update the stored label
            // so the management projection stays in sync.
            await UPDATE(PIPELINES).set({ origin: this.origin }).where({ name: this.name })
        }
    }

    async _getTracker() {
        return SELECT.one.from(PIPELINES).where({ name: this.name })
    }

    /**
     * Reset the tracker row and clear the target. ADR 0008: when the
     * target mixes in the `sourced` aspect and this pipeline carries an
     * origin label, only rows tagged with that origin are deleted —
     * sibling origins in the same table are left intact. Legacy
     * pipelines (no aspect, no origin) keep today's truncate semantics.
     */
    async clear() {
        if (this.hasSourceAspect && this.origin) {
            await this.targetAdapter.deleteSlice(this.config.target, { source: this.origin })
            LOG._info && LOG.info(
                `Pipeline '${this.name}': flush scoped to source='${this.origin}'`
            )
        } else {
            await this.targetAdapter.truncate(this.config.target)
        }
        await UPDATE(PIPELINES).set({
            lastSync: null,
            lastKey: null,
            status: 'idle',
            errorCount: 0,
            statistics_created: 0,
            statistics_updated: 0,
            statistics_deleted: 0,
        }).where({ name: this.name })
    }

    async getStatus() {
        return this._getTracker()
    }
}

module.exports = Pipeline

const cds = require('@sap/cds')
const Pipeline = require('./lib/Pipeline')

const LOG = cds.log('cds-data-pipeline')

const PIPELINE_EVENTS = [
    'PIPELINE.START',
    'PIPELINE.READ',
    'PIPELINE.MAP_BATCH',
    'PIPELINE.WRITE_BATCH',
    'PIPELINE.DONE',
]

const VALID_SOURCE_KINDS = new Set(['cqn', 'odata', 'odata-v2', 'rest'])

// Row-delta `delta.mode` values are only meaningful for entity-shape reads.
// Query-shape pipelines must use `mode: 'full'` or `mode: 'partial-refresh'`.
const ROW_DELTA_MODES = new Set(['timestamp', 'key', 'datetime-fields'])

const DOC_REF = `See https://mikezaschka.github.io/cds-data-pipeline/concepts/inference/ ` +
    `for the full inference + registration-validation rules.`

const DOC_REF_FAN_IN = `See https://mikezaschka.github.io/cds-data-pipeline/recipes/multi-source/ ` +
    `for the multi-source fan-in rules.`

/**
 * CDS service that orchestrates configured pipelines.
 *
 * Extends `cds.Service` so the pipeline runs through CAP's native event
 * dispatch. Five namespaced events bracket each run (prefix avoids
 * collision with CAP's CRUD aliases `READ` / `WRITE`):
 *
 *   PIPELINE.START       — once per run, before READ
 *   PIPELINE.READ        — once per run, stream setup
 *   PIPELINE.MAP_BATCH   — per batch
 *   PIPELINE.WRITE_BATCH — per batch, after MAP_BATCH
 *   PIPELINE.DONE        — once per run, success or failure
 *
 * Defaults per pipeline are stored in internal maps and invoked from a
 * single service-level `on()` router. User hooks registered via the standard
 * CAP `srv.before(event, path, handler)` / `srv.after(event, path, handler)`
 * API compose with defaults through CAP's native before -> on -> after chain.
 */
class DataPipelineService extends cds.Service {

    async init() {
        this.pipelines = new Map()

        // Per-pipeline default handlers keyed by pipeline name.
        this._defaults = Object.fromEntries(
            PIPELINE_EVENTS.map(e => [e, new Map()])
        )

        // A single catch-all router for each pipeline event. Looks up the
        // default handler registered for `req.data.pipeline` and invokes
        // it; if no default is registered, calls `next()` so user-provided
        // `on` handlers can still supply the behavior.
        for (const event of PIPELINE_EVENTS) {
            this.on(event, (req, next) => this._route(event, req, next))
        }

        // Shared PIPELINE.TICK handler for the queued engine. Registered
        // unconditionally so ad-hoc `execute({ async: true, engine: 'queued' })`
        // works whether or not any pipeline carries a queued schedule. The
        // scheduled-schedule path (`_scheduleQueued`) reuses this handler
        // via `cds.queued(this).schedule('PIPELINE.TICK', { name })`.
        this.on('PIPELINE.TICK', async (req) => {
            const { name, mode = 'delta', trigger = 'scheduled', runId } = req.data || {}
            if (!name) return
            const pipeline = this.pipelines.get(name)
            if (!pipeline) {
                LOG.warn(`PIPELINE.TICK received for unknown pipeline '${name}'`)
                return
            }
            await pipeline._run(mode, trigger, runId)
        })

        await super.init()
    }

    /**
     * Register a pipeline. Pipeline behavior is inferred from the config
     * shape (`source.query` vs. `source.entity`) and dispatched through
     * protocol-specific source adapters and the configured target adapter.
     * See ADR 0007 and `concepts/inference.md` in the `cds-data-pipeline`
     * docs for the inference rules and the registration-time validation
     * matrix.
     */
    async addPipeline(config) {
        this._validateConfig(config)
        const { name } = config
        if (this.pipelines.has(name)) {
            throw new Error(`Pipeline configuration '${name}' already exists`)
        }

        const internalConfig = this._normalizeConfig(config)

        try {
            const pipeline = new Pipeline(name, internalConfig, this)
            await pipeline.init()
            this.pipelines.set(name, pipeline)

            if (internalConfig.schedule) {
                this._scheduleJob(name, internalConfig.schedule)
                LOG._info && LOG.info(
                    `Pipeline '${name}' has an internal schedule (engine=${internalConfig.schedule.engine}). ` +
                    `Omit 'schedule' and call POST /pipeline/run from an external scheduler ` +
                    `(SAP BTP Job Scheduling, Kubernetes CronJob, ...) if centralized scheduling is preferred.`
                )
            }

            LOG._info && LOG.info(this._composeRegistrationLog(name, internalConfig, pipeline))
        } catch (err) {
            LOG._error && LOG.error(`Failed to add pipeline ${name}:`, err)
            throw err
        }

        return this
    }

    /**
     * Shape-based startup log line per ADR 0007 §"Observability compensation".
     * Strictly more informative than the old `kind=…` string: it names the
     * read shape, source/target refs, mode + delta mode, and the adapter
     * class resolved for the READ phase.
     *
     * Example:
     *   [cds-data-pipeline] registered 'OrdersCopy' — entity-shape from
     *     ProviderService.Orders → db.ArchivedOrders, mode=delta(timestamp
     *     modifiedAt), adapter=ODataAdapter
     */
    _composeRegistrationLog(name, config, pipeline) {
        const shape = config.source && config.source.query ? 'query-shape' : 'entity-shape'
        const sourceRef = (config.source && config.source.service ? config.source.service + '.' : '') +
            (config.source && config.source.entity ? config.source.entity : '<query>')
        const targetService = (config.target && config.target.service) || 'db'
        const targetRef = targetService + '.' + (config.target && config.target.entity ? config.target.entity : '<unknown>')
        const deltaMode = config.delta && config.delta.mode
        const deltaField = config.delta && config.delta.field
        const modePhrase = config.mode === 'full'
            ? 'full'
            : config.mode + (deltaMode ? '(' + deltaMode + (deltaField ? ' ' + deltaField : '') + ')' : '')
        const adapterName = (pipeline && pipeline.adapter && pipeline.adapter.constructor && pipeline.adapter.constructor.name) || '<unresolved>'
        const origin = config.source && config.source.origin
        const originSuffix = origin ? `, origin=${origin}` : ''
        return `registered '${name}' — ${shape} from ${sourceRef} → ${targetRef}, mode=${modePhrase}, adapter=${adapterName}${originSuffix}`
    }

    /**
     * Execute a pipeline. Uniform envelope return in all modes.
     *
     *   @param {string} name
     *   @param {object} [opts]
     *   @param {'full'|'delta'|'partial-refresh'} [opts.mode='delta']
     *   @param {'manual'|'scheduled'|'external'|'event'} [opts.trigger='manual']
     *   @param {boolean} [opts.async=false]   true = fire-and-forget, false = block
     *   @param {'spawn'|'queued'} [opts.engine='spawn']  only honored when async=true
     *   @returns {Promise<{ runId: string, name: string, done?: Promise }>}
     *
     * Behavior:
     *   - async=false: awaits the run; resolves with `done` already settled
     *     to `{ status, statistics }`. Failures throw.
     *   - async=true, engine='spawn': resolves immediately; `done` is a
     *     pending Promise that resolves to `{ status, statistics }` on
     *     success or rejects on failure. Unhandled rejections are also
     *     logged via cds.log.
     *   - async=true, engine='queued': resolves after the enqueue; `done`
     *     is omitted (the run may execute on another instance). Use
     *     `after('PIPELINE.DONE', name, ...)` for notifications.
     */
    async execute(name, { mode = 'delta', trigger = 'manual', async: isAsync = false, engine = 'spawn' } = {}) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }

        const runId = cds.utils.uuid()

        if (!isAsync) {
            const result = await pipeline._run(mode, trigger, runId)
            return { runId, name, done: Promise.resolve(result) }
        }

        if (engine === 'queued') {
            if (typeof cds.queued !== 'function') {
                throw new Error(
                    `execute: async with engine='queued' requires a CAP runtime that exposes ` +
                    `cds.queued(srv). Update @sap/cds, or use async:true with engine:'spawn' ` +
                    `(default), or omit async for a blocking run.`
                )
            }
            const queued = cds.queued(this)
            if (!queued || typeof queued.emit !== 'function') {
                throw new Error(
                    `execute: cds.queued(srv).emit(...) is not available on this CAP runtime. ` +
                    `Fall back to engine:'spawn' or a blocking call.`
                )
            }
            await queued.emit('PIPELINE.TICK', { name, mode, trigger, runId })
            return { runId, name }
        }

        // engine === 'spawn' (default async path)
        let resolve, reject
        const done = new Promise((res, rej) => { resolve = res; reject = rej })
        cds.spawn(async () => {
            try {
                resolve(await pipeline._run(mode, trigger, runId))
            } catch (err) {
                LOG._error && LOG.error(`Async pipeline '${name}' failed:`, err)
                reject(err)
            }
        })
        return { runId, name, done }
    }

    async getStatus(name) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        return pipeline.getStatus()
    }

    async clear(name) {
        const pipeline = this.pipelines.get(name)
        if (!pipeline) {
            throw new Error(`Unknown pipeline: ${name}`)
        }
        await pipeline.clear()
    }

    /**
     * Register an internal default handler for a pipeline phase.
     * Called by `Pipeline.init()` — not part of the public API.
     */
    registerDefault(event, pipelineName, handler) {
        const bucket = this._defaults[event]
        if (!bucket) {
            throw new Error(`Unknown pipeline event '${event}'`)
        }
        bucket.set(pipelineName, handler)
    }

    _route(event, req, next) {
        const pipelineName = req.data && req.data.pipeline
        const handler = pipelineName && this._defaults[event].get(pipelineName)
        if (handler) return handler(req)
        return typeof next === 'function' ? next() : undefined
    }

    /**
     * Dispatch a pipeline schedule to the configured engine. `schedule` has
     * already been normalized to `{ every, engine }` by `_normalizeConfig`.
     *
     *   - `engine: 'spawn'` (default) — in-process `cds.spawn({ every })`.
     *     Best-effort, fires on every app instance, no persistence across
     *     restarts, no retry. Matches pre-0.2 behaviour.
     *   - `engine: 'queued'` — `cds.queued(this).schedule(...).every(...)`
     *     backed by the CAP persistent task queue. Single-winner across
     *     app instances, survives restarts, exponential retry + dead-letter
     *     via `cds.outbox.Messages`. The underlying CAP API is marked
     *     Alpha; opt in per-pipeline.
     */
    _scheduleJob(name, schedule) {
        const { every, engine } = schedule
        if (engine === 'queued') return this._scheduleQueued(name, every)
        return this._scheduleSpawn(name, every)
    }

    _scheduleSpawn(name, every) {
        const interval = typeof every === 'number' ? every : parseInt(every, 10)
        if (!interval || interval <= 0) {
            LOG.warn(`Invalid schedule for '${name}': ${every}`)
            return
        }
        const pipeline = this.pipelines.get(name)
        cds.spawn({ every: interval }, async () => {
            try {
                await pipeline._run('delta', 'scheduled')
            } catch (err) {
                LOG._error && LOG.error(`Scheduled pipeline failed for ${name}:`, err)
            }
        })
    }

    _scheduleQueued(name, every) {
        if (typeof cds.queued !== 'function') {
            throw new Error(
                `addPipeline: schedule.engine='queued' requires a CAP runtime that exposes ` +
                `cds.queued(srv).schedule(...).every(...). Update @sap/cds, or use ` +
                `schedule: <ms> / schedule: { every, engine: 'spawn' } / omit schedule ` +
                `and trigger externally via POST /pipeline/run.`
            )
        }

        // The shared PIPELINE.TICK handler is registered in `init()` so
        // both scheduled and ad-hoc queued execution share one dispatch
        // path. Here we only enqueue the recurring schedule message.
        const queued = cds.queued(this)
        if (!queued || typeof queued.schedule !== 'function') {
            throw new Error(
                `addPipeline: cds.queued(srv).schedule(...) is not available on this CAP runtime. ` +
                `Use schedule: <ms> or omit schedule and trigger externally.`
            )
        }

        const handle = queued.schedule('PIPELINE.TICK', { name })
        if (!handle || typeof handle.every !== 'function') {
            throw new Error(
                `addPipeline: cds.queued(srv).schedule(...).every(...) is not available on this ` +
                `CAP runtime. The task scheduling API is documented as Alpha; check the CAP release ` +
                `notes or fall back to schedule.engine='spawn'.`
            )
        }
        handle.every(every)
    }

    /**
     * Registration-time invariants per ADR 0007 §"Registration-time
     * validation matrix". Pipeline behavior is inferred from config shape.
     * Rows 1-5 are shape invariants; rows 6-8 are target-adapter capability
     * checks evaluated against the resolved `TargetAdapter.capabilities()`.
     */
    _validateConfig(config) {
        if (!config || typeof config !== 'object') {
            throw new Error(`addPipeline requires a configuration object`)
        }
        const { name } = config
        if (!name) {
            throw new Error(`addPipeline requires 'name'`)
        }

        const source = config.source
        const hasQuery = !!(source && source.query)
        const hasEntity = !!(source && source.entity)
        // REST pipelines address their source via `config.rest.path` rather
        // than a CAP entity reference. Treat `rest.path` as an entity-shape
        // signal equivalent to `source.entity` for Row 1 / Row 2 purposes.
        const hasRestPath = !!(config.rest && config.rest.path)
        const hasEntityShape = hasEntity || hasRestPath

        // Row 1: ambiguous source shape
        if (hasQuery && hasEntityShape) {
            throw new Error(
                `addPipeline: ambiguous source shape for pipeline '${name}' — set one of ` +
                `source.query or source.entity (or rest.path for REST sources), not both. ` +
                DOC_REF
            )
        }

        // Row 2: missing source shape
        if (!hasQuery && !hasEntityShape) {
            throw new Error(
                `addPipeline: missing source shape for pipeline '${name}' — set either ` +
                `source.entity (or rest.path for REST sources) for entity-shape reads ` +
                `or source.query for query-shape reads. ` + DOC_REF
            )
        }

        // Row 3: query-shape + mode: 'delta' → row-delta requires entity-shape
        if (hasQuery && config.mode === 'delta') {
            throw new Error(
                `addPipeline: row-delta requires entity-shape source (source.entity) for pipeline '${name}'; ` +
                `query-shape reads use mode: 'full' or mode: 'partial-refresh'. ${DOC_REF}`
            )
        }

        // Row 4: query-shape + delta.mode ∈ { timestamp, key, datetime-fields }
        if (hasQuery && config.delta && ROW_DELTA_MODES.has(config.delta.mode)) {
            throw new Error(
                `addPipeline: delta.mode '${config.delta.mode}' requires entity-shape source for pipeline '${name}'; ` +
                `query-shape reads do not support row-delta. ${DOC_REF}`
            )
        }

        // Row 5: mode: 'partial-refresh' without refresh.slice
        const refresh = config.refresh
        const partialViaMode = config.mode === 'partial-refresh'
        const partialViaRefresh = refresh && typeof refresh === 'object' && refresh.mode === 'partial'
        if ((partialViaMode || partialViaRefresh) &&
            (!refresh || typeof refresh !== 'object' || typeof refresh.slice !== 'function')) {
            throw new Error(
                `addPipeline: partial-refresh requires refresh.slice: (tracker) => <CQN predicate> ` +
                `for pipeline '${name}'. ${DOC_REF}`
            )
        }

        this._validateSource(config)
        this._validateOrigin(config)
    }

    /**
     * ADR 0008 §"Engine behavior when `source.origin` is set".
     *
     * The `source.origin` label stamps an origin string into the target's
     * `source` key column so N sibling pipelines can consolidate into one
     * target entity. Two invariants are enforced at registration so
     * misconfigurations fail before any data is written:
     *
     *   1. `source.origin` + `source.query` — materialize (query-shape) is
     *      origin-agnostic. The snapshot rebuild semantics ignore row-level
     *      discriminators.
     *   2. `source.origin` + target entity missing the `key source` element
     *      — the stamp has nowhere to land. The error points at
     *      `plugin.data_pipeline.sourced` from `cds-data-pipeline/db`.
     */
    _validateOrigin(config) {
        const source = config.source
        const origin = source && source.origin
        if (origin === undefined || origin === null) return

        const { name } = config

        if (source && source.query) {
            throw new Error(
                `addPipeline: source.origin is not supported with source.query for pipeline '${name}' — ` +
                `materialize (query-shape) rebuilds the target snapshot and is origin-agnostic. ` +
                DOC_REF_FAN_IN
            )
        }

        const targetEntity = config.target && config.target.entity
        const def = targetEntity && cds.model && cds.model.definitions && cds.model.definitions[targetEntity]
        const el = def && def.elements && def.elements.source
        const hasAspect = !!(el && el.key === true)

        if (!hasAspect) {
            throw new Error(
                `addPipeline: source.origin='${origin}' requires the target entity '${targetEntity}' ` +
                `to include the 'plugin.data_pipeline.sourced' aspect (adds 'key source : String'). ` +
                `Import it via: using { plugin.data_pipeline.sourced } from 'cds-data-pipeline/db'; ` +
                `and mix it into '${targetEntity}'. ${DOC_REF_FAN_IN}`
            )
        }
    }

    /**
     * Capability-based registration validation — ADR 0007 rows 6-8.
     * Invoked from `Pipeline.init()` after the target adapter has been
     * resolved (the source-shape invariants in `_validateConfig` above
     * are cheap enough to run before adapter resolution; the capability
     * checks are not because they need the adapter instance).
     *
     * Row 6: `mode: 'delta'` requires key-addressable UPSERT writes.
     * Row 7: `mode: 'full'` requires truncate or batch-delete support.
     * Row 8: `source.query` (query-shape snapshot write) requires batch
     *        INSERT support.
     */
    _validateTargetCapabilities(config, targetAdapter) {
        const caps = (targetAdapter && typeof targetAdapter.capabilities === 'function')
            ? targetAdapter.capabilities()
            : {}
        const { name } = config
        const adapterName = (targetAdapter && targetAdapter.constructor && targetAdapter.constructor.name) || 'TargetAdapter'

        // Row 6: delta writes need keyed UPSERT.
        if (config.mode === 'delta' && !caps.keyAddressableUpsert) {
            throw new Error(
                `addPipeline: target adapter '${adapterName}' for pipeline '${name}' ` +
                `lacks keyAddressableUpsert — delta pipelines require keyed UPSERT. ` +
                `Use mode: 'full' or pick a different target. ${DOC_REF}`
            )
        }

        // Row 7: full refresh needs truncate or batch-delete.
        if (config.mode === 'full' && !caps.truncate && !caps.batchDelete) {
            throw new Error(
                `addPipeline: target adapter '${adapterName}' for pipeline '${name}' ` +
                `cannot truncate or batch-delete — mode: 'full' requires at least one. ` +
                `${DOC_REF}`
            )
        }

        // Row 8: query-shape (snapshot write) needs batch-insert.
        if (config.source && config.source.query && !caps.batchInsert) {
            throw new Error(
                `addPipeline: target adapter '${adapterName}' for pipeline '${name}' ` +
                `lacks batchInsert — query-shape (source.query) pipelines rebuild the ` +
                `target via INSERT after the engine clears the slice. ${DOC_REF}`
            )
        }
    }

    /**
     * Source-transport level checks (unrelated to pipeline shape). The only
     * enforced invariant here is that `source.kind` — when set — refers to
     * a known adapter. Shape contradictions with `source.kind: 'cqn'` are
     * covered by `_validateConfig` rows 1 and 2 above.
     */
    _validateSource(config) {
        const { name, source } = config
        if (!source) return

        if (source.kind !== undefined && !VALID_SOURCE_KINDS.has(source.kind)) {
            throw new Error(
                `addPipeline: unknown source.kind='${source.kind}' for pipeline '${name}'. ` +
                `Expected one of: ${[...VALID_SOURCE_KINDS].join(', ')}.`
            )
        }
    }

    /**
     * Fill adapter-facing defaults. Shape-driven: the presence or absence
     * of `source.query` decides the pipeline mode, delta mode, and refresh
     * default. No derived-enum fields — dispatch runs off the source /
     * target adapter factories, not off a stored discriminator.
     */
    _normalizeConfig(config) {
        const isQueryShape = !!(config.source && config.source.query)

        const normalized = {
            name: config.name,
            source: {
                batchSize: 1000,
                maxRetries: 3,
                retryDelay: 1000,
                delay: 0,
                ...config.source,
            },
            target: {
                ...config.target,
            },
            mode: config.mode || (isQueryShape ? 'full' : 'delta'),
            delta: {
                mode: isQueryShape ? 'full' : 'timestamp',
                field: 'modifiedAt',
                ...config.delta,
            },
            rest: config.rest,
            schedule: this._normalizeSchedule(config.schedule, config.name),
            viewMapping: config.viewMapping || {
                isWildcard: true,
                projectedColumns: [],
                localToRemote: {},
                remoteToLocal: {},
            },
        }

        if (config.refresh !== undefined) {
            normalized.refresh = config.refresh
        } else if (isQueryShape) {
            normalized.refresh = 'full'
        }

        return normalized
    }

    /**
     * Normalize `schedule` into `{ every, engine }` or `undefined`.
     *
     * Accepted shapes:
     *   - unset / null / 0 / ''   -> `undefined` (no internal timer; external
     *                                trigger via POST /pipeline/run is the
     *                                expected path).
     *   - number (milliseconds)    -> `{ every: <number>, engine: 'spawn' }`
     *                                (backwards-compatible default).
     *   - { every, engine? }       -> passed through; `engine` defaults to
     *                                `'spawn'`. Supported engines: `spawn`,
     *                                `queued`.
     */
    _normalizeSchedule(schedule, pipelineName) {
        if (schedule === undefined || schedule === null || schedule === 0 || schedule === '') {
            return undefined
        }
        if (typeof schedule === 'number' || typeof schedule === 'string') {
            return { every: schedule, engine: 'spawn' }
        }
        if (typeof schedule === 'object') {
            const engine = schedule.engine || 'spawn'
            if (engine !== 'spawn' && engine !== 'queued') {
                throw new Error(
                    `addPipeline: unknown schedule.engine='${engine}' for pipeline '${pipelineName}'. ` +
                    `Expected 'spawn' or 'queued'.`
                )
            }
            if (schedule.every === undefined || schedule.every === null) {
                throw new Error(
                    `addPipeline: schedule.every is required when schedule is an object ` +
                    `for pipeline '${pipelineName}'.`
                )
            }
            return { every: schedule.every, engine }
        }
        throw new Error(
            `addPipeline: invalid schedule for pipeline '${pipelineName}'. ` +
            `Expected a number (ms), a string ('10m'), or { every, engine? }.`
        )
    }
}

module.exports = DataPipelineService

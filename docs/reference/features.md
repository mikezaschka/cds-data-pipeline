# Features

What `cds-data-pipeline` does, grouped by capability. Programmatic API reference is in [Management Service](management-service.md); protocol-specific notes are in the [OData](../sources/odata.md) and [REST](../sources/rest.md) adapter pages.

## Source adapters

The READ phase of every pipeline uses a protocol-specific adapter. The adapter is selected automatically from the remote service's `kind`; custom adapters extend `BaseSourceAdapter` and implement `readStream(tracker)`.

| Adapter | Protocol support | Reference |
|---|---|---|
| **OData V4** | Batch reads with `$select` restriction, all three delta modes, `$top` / `$skip` pagination. | [Sources → OData V2 / V4](../sources/odata.md) |
| **OData V2** | Same surface as V4, with V2 timestamp quirks handled. Provider needs `@cap-js-community/odata-v2-adapter`. | [Sources → OData V2 / V4](../sources/odata.md) |
| **REST** | Cursor / offset / page pagination, configurable delta URL parameter, nested-response extraction via `dataPath`. | [Sources → REST Adapter](../sources/rest.md) |
| **CQN** | Reads from CQN-native services (in-process CAP services, `cds.requires` DB bindings, CAP-wrapped legacy DBs). Serves both entity-shape (row-preserving) and query-shape (derived / aggregated snapshot) reads based on whether `source.query` is supplied. | [Sources → CQN Adapter](../sources/cqn.md) |
| **Server-driven paging** | Adapters keep paging until the remote returns an empty batch — transparent to the replication config. | Applies to OData V4 and V2 adapters. |
| **Multi-source fan-in** | Consolidate the same logical entity from N backends into one target table via sibling pipelines, each stamping a `source.origin` label into a `source` key column contributed by the `plugin.data_pipeline.sourced` aspect. Per-origin `flush` and `mode: 'full'` scope DELETEs to their own origin. | [Recipes → Multi-source](../recipes/multi-source.md) |
| **Auto-selection + custom base class** | Selected automatically from the service's `kind`, or routed explicitly via `source.kind` / `source.adapter` class ref. Custom adapters extend `BaseSourceAdapter`. | [Sources → Custom source adapter](../sources/custom.md) |

## Target adapters

The WRITE phase (and pre-write truncate / delete-slice) is delegated to a `BaseTargetAdapter`. The adapter is resolved from `target.adapter` (class ref) or `target.service` (with `db` / unset → `DbTargetAdapter`).

| Adapter | Primitives | Reference |
|---|---|---|
| **`DbTargetAdapter`** (default) | `UPSERT` / `INSERT` / `DELETE` via `cds.connect.to('db')`. Reports all four capabilities (`keyAddressableUpsert`, `truncate`, `batchDelete`, `batchInsert`). | [Targets → Local DB](../targets/db.md) |
| **`ODataTargetAdapter`** | Resolved when `target.kind` is `'odata' / 'odata-v2'`, or when the connected remote service advertises that kind. Routes `UPSERT` / `INSERT` through CAP's remote runtime (POST / PUT / PATCH, with `$batch` change sets where supported); `truncate` / `deleteSlice` page keys + issue per-row DELETE. Reports all four capabilities. | [Targets → OData](../targets/odata.md), [Recipes → Built-in replicate](../recipes/built-in-replicate.md#to-a-remote-odata-target) |
| **Custom target adapter** | Pluggable class extending `BaseTargetAdapter` with `writeBatch`, `truncate`, `deleteSlice`, and `capabilities()`. Used for non-db, non-OData targets (message buses, custom HTTP APIs, …). | [Targets → Custom target adapter](../targets/custom.md), [Recipes → Custom target adapter](../recipes/custom-target-adapter.md) |

## Management service

An OData service for operating pipelines at runtime. See [Management Service](management-service.md).

| Endpoint | What it does |
|---|---|
| **`Pipelines`** | Read-only listing of all registered pipelines with source / target config, status, last sync, and statistics. |
| **`PipelineRuns`** | Per-run history with start / end timestamps, trigger, mode, statistics, and error details. |
| **`run` action** | Trigger a pipeline run programmatically or via HTTP. |
| **`flush` action** | Clear pipeline output and reset tracker for a named pipeline. |
| **`status` function** | Get the current status of a named pipeline. |

## Observability

| Capability | What it does |
|---|---|
| **Pipeline tracker** | `Pipelines` table persists name, source, target, mode, `lastSync`, `lastKey`, and status per pipeline. Behaviour is inferred from config shape at registration — no stored discriminator (see [Inference rules](../concepts/inference.md)). |
| **Run history** | Every run gets a `PipelineRuns` record with full context and timing. |
| **Statistics** | `created` / `updated` / `deleted` / `skipped` counts per run and cumulative. |
| **Request-level tracking** | Optional per-batch tracking with source and target data snapshots for debugging. |

## Scheduling and triggers

Three ways to drive a pipeline. Pick the one that matches your operational model — they can be mixed across pipelines in the same app.

| Capability | What it does | When to pick it |
|---|---|---|
| **In-process `spawn` scheduling** (default) | Periodic runs driven by `cds.spawn({ every })`. `schedule: 600000` or `schedule: { every, engine: 'spawn' }`. Best-effort; fires on every app instance. | Single-instance deployments, dev, best-effort cadence. |
| **In-process `queued` scheduling** | Persistent task queue via `cds.queued(srv).schedule(...).every(...)`. `schedule: { every: '10m', engine: 'queued' }`. Single-winner across app instances, survives restarts, retries with exponential backoff. Requires `cds.outbox.Messages`; underlying CAP API is experimental. | Self-contained CAP apps running with >1 instance that want persistence and cross-instance safety. See [Recipes → Internal scheduling with the queued engine](../recipes/internal-scheduling-queued.md). |
| **External trigger** | Omit `schedule` entirely and call `POST /pipeline/run` from an external scheduler (SAP BTP Job Scheduling Service, Kubernetes `CronJob`, ...). The `run` action accepts `trigger` and `async` parameters for correct attribution and fire-and-forget 202 responses. | Centralized corporate cron, BTP-native operations, org-level observability. See [Recipes → External scheduling with SAP BTP Job Scheduling Service](../recipes/external-scheduling-jss.md). |
| **Manual trigger** | Programmatic `run()` API and the `run` OData action. | Ad-hoc runs, scripts, tests. |

## Resilience

| Capability | What it does |
|---|---|
| **Retry with exponential backoff** | All remote I/O is wrapped in a configurable retry policy. |
| **Concurrency guard** | A pipeline cannot run twice in parallel — a DB-status-based lock rejects the second trigger. |
| **Transactional batches** | Choose per-batch or full-run transaction scope for replication. |

## Configuration

| Capability | What it does |
|---|---|
| **Programmatic API** | `addPipeline()` for dynamic runtime configuration. |
| **Profile-based overrides** | Different settings per CAP environment profile (`[development]`, `[production]`, …) via the native `cds.env` mechanism. |
| **Sensible defaults** | Batch size 1000, 10-minute schedule, `delta` mode for entity-shape reads, `full` mode for query-shape reads, auto-retry 3×. |

## Security

| Capability | What it does |
|---|---|
| **Credential isolation** | Each source and target uses its own service credentials via `cds.requires`, managed by CAP's native `cds.connect.to()`. |

## Pipeline event hooks

`DataPipelineService` is a standard `cds.Service`. Register hooks for every phase via the CAP-native API — full reference with signatures and ordering notes is on the [Management Service](management-service.md#event-hooks) page.

| Event | Fires | `req.data` |
|---|---|---|
| `PIPELINE.START` | Once per run, before READ | `runId`, `mode`, `trigger`, `config`, `tracker` |
| `PIPELINE.READ` | Once per run, before batch iteration | `runId`, `config`, `source`, `target` → handler sets `sourceStream` (async iterable) |
| `PIPELINE.MAP_BATCH` | Once per batch | `runId`, `batchIndex`, `sourceRecords`, `targetRecords` (handler fills `targetRecords`) |
| `PIPELINE.WRITE_BATCH` | Once per batch, after MAP_BATCH | `runId`, `batchIndex`, `targetRecords` (handler writes and sets `statistics`) |
| `PIPELINE.DONE` | Once per run, success or failure | `runId`, `status`, `mode`, `trigger`, `startTime`, `endTime`, `statistics`, `error?` |

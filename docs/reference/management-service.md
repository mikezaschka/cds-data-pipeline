# Management Service

The `cds-data-pipeline` engine exposes an OData service at `/pipeline` for inspecting and controlling registered pipelines at runtime. Every pipeline registered via `addPipeline(...)` surfaces here with its tracker state, run history, and manual-trigger actions.

## Tracker schema

The tracker tables are shipped as a CDS model under namespace `plugin.data_pipeline` in `db/index.cds`. They are materialized by `cds deploy` (SQLite) or the HDI deployer (HANA) — the plugin performs no runtime DDL.

```cds
namespace plugin.data_pipeline;

using { cuid } from '@sap/cds/common';

type ReplicationMode : String enum { delta; full; }
type RunStatus : String enum { idle; running; failed; }
type RunTrigger : String enum { manual; scheduled; external; event; }

@cds.persistence.table
entity Pipelines {
    key name       : String;
        source     : LargeString;         // JSON serialized source config
        target     : LargeString;         // JSON serialized target config
        mode       : ReplicationMode;
        lastSync   : Timestamp;
        lastKey    : String;
        status     : RunStatus default 'idle';
        errorCount : Integer default 0;
        lastError  : String;
        statistics : {
            created : Integer default 0;
            updated : Integer default 0;
            deleted : Integer default 0;
        };
        runs       : Composition of many PipelineRuns on runs.pipeline = $self;
}

@cds.persistence.table
entity PipelineRuns : cuid {
    pipeline   : Association to one Pipelines;
    status     : RunStatus;
    startTime  : Timestamp;
    endTime    : Timestamp;
    trigger    : RunTrigger;
    mode       : ReplicationMode;
    error      : LargeString;
    statistics : {
        created : Integer default 0;
        updated : Integer default 0;
        deleted : Integer default 0;
    };
}
```

The management OData service (`DataPipelineManagementService`, served at `/pipeline`) projects both entities read-only plus three actions. All mutating actions require the `PipelineRunner` scope; read projections require an authenticated user.

```cds
using { plugin.data_pipeline as pipeline } from '../db/index.cds';

service DataPipelineManagementService @(path: '/pipeline') {
    @readonly @(requires: 'authenticated-user')
    entity Pipelines    as projection on pipeline.Pipelines;

    @readonly @(requires: 'authenticated-user')
    entity PipelineRuns as projection on pipeline.PipelineRuns;

    @(requires: 'PipelineRunner')
    action   run(
        name    : String,
        mode    : String,
        trigger : String,
        async   : Boolean
    ) returns String;

    @(requires: 'PipelineRunner')
    action   flush(name : String) returns String;

    @(requires: 'authenticated-user')
    function status(name : String) returns Pipelines;
}
```

## Entities

### `Pipelines`

One record per registered pipeline. Holds the tracker state used by the concurrency guard and delta sync.

```http
GET /pipeline/Pipelines
```

| Field | Description |
|---|---|
| `name` | Pipeline name (often the target entity name). |
| `source` | JSON-serialized source config (`service`, `entity`, `kind`, pagination, delta). Function values (`source.query`) are serialized as the marker string `"[Function]"`. |
| `target` | JSON-serialized target config (`service`, `entity`). |
| `mode` | Effective run mode — `delta` or `full`. |
| `lastSync` | ISO timestamp of the last successful run (delta watermark for timestamp mode). |
| `lastKey` | High-watermark key value for `key` delta mode. |
| `status` | `idle` \| `running` \| `failed`. The concurrency guard flips this to `running` via an optimistic `UPDATE … WHERE status != 'running'`. |
| `errorCount` | Cumulative count of failed runs since the last successful one. |
| `lastError` | Last error message (truncated). |
| `statistics` | Cumulative `created` / `updated` / `deleted` counts across all runs. |

### `PipelineRuns`

One record per execution — success or failure.

```http
GET /pipeline/PipelineRuns?$filter=pipeline_name eq 'BusinessPartners'&$orderby=startTime desc
```

| Field | Description |
|---|---|
| `ID` | Run identifier (`cuid`). |
| `pipeline` | Association to the owning `Pipelines` row (`pipeline_name` on the wire). |
| `trigger` | `manual` \| `scheduled` \| `external` \| `event`. `scheduled` is set by the in-process scheduler; `external` is set when the caller of `POST /pipeline/run` passes `trigger: "external"` (used by BTP Job Scheduling Service, Kubernetes `CronJob`, ...). |
| `mode` | `full` \| `delta`. |
| `startTime` / `endTime` | ISO timestamps. |
| `status` | `running` \| `idle` \| `failed`. |
| `statistics` | Per-run `created` / `updated` / `deleted` counts. |
| `error` | Error payload (JSON) for failed runs. |

## Actions

### `run`

Trigger a pipeline execution. Used by scripts, tests, and external schedulers (SAP BTP Job Scheduling Service, Kubernetes `CronJob`, ...).

```http
POST /pipeline/run
Content-Type: application/json
Authorization: Bearer <token with PipelineRunner scope>

{
  "name": "ReplicatedPartners",
  "mode": "full",
  "trigger": "external",
  "async": true
}
```

| Parameter | Required | Default | Description |
|---|---|---|---|
| `name` | yes | — | Name of a pipeline registered via `addPipeline(...)`. |
| `mode` | no | `delta` (entity-shape) / `full` (query-shape) | Run mode for this invocation. |
| `trigger` | no | `manual` | Recorded as the `trigger` column on `PipelineRuns`. Whitelisted to the `RunTrigger` enum values. Use `external` for runs fired by an external scheduler so the run history is attributed correctly. |
| `async` | no | `false` | If `true`, the action dispatches the run via `cds.spawn` and returns `202 Accepted` immediately. Use this when the pipeline may exceed the caller's HTTP response window (JSS has a fixed timeout). Errors during the async run still land in `PipelineRuns`. |

See the external-trigger walkthrough at [Recipes → External scheduling with SAP BTP Job Scheduling Service](../recipes/external-scheduling-jss.md).

### `flush`

Clear the local pipeline output and reset the tracker — next run will be a full sync.

```http
POST /pipeline/flush
Content-Type: application/json

{ "name": "ReplicatedPartners" }
```

### `status`

Fetch a single tracker record by name.

```http
GET /pipeline/status(name='ReplicatedPartners')
```

## Programmatic API

`DataPipelineService` is a standard `cds.Service` — resolve it via `cds.connect.to('DataPipelineService')` and register hooks via the standard CAP API.

```javascript
const cds = require('@sap/cds');

const pipelines = await cds.connect.to('DataPipelineService');

// Filter records before MAP (before hooks receive the request only)
pipelines.before('PIPELINE.MAP', 'ReplicatedPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});

// Custom MAP default — overrides the built-in rename mapping
pipelines.on('PIPELINE.MAP', 'ReplicatedPartners', async (req) => {
    req.data.targetRecords = req.data.sourceRecords.map(record => ({
        ID: record.BusinessPartner,
        name: record.BusinessPartnerFullName,
        sourceService: req.data.source.service,
    }));
});

// Enrich after MAP (after hooks receive `(results, req)` per CAP convention)
pipelines.after('PIPELINE.MAP', 'ReplicatedPartners', async (_results, req) => {
    req.data.targetRecords = req.data.targetRecords.map(r => ({
        ...r,
        classification: classify(r),
    }));
});

// Define a pipeline programmatically. Behaviour is inferred from the config
// shape (see Inference rules). `source.entity` + db target → entity-shape,
// mode 'delta', DbTargetAdapter on the write side.
await pipelines.addPipeline({
    name: 'BusinessPartners',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.BusinessPartners' },
    delta: { field: 'modifiedAt', mode: 'timestamp' },
});

// Run on demand
await pipelines.run('BusinessPartners');
```

### Event hooks

Pipeline events are namespaced to avoid collision with CAP's CRUD aliases (`READ`, `WRITE`):

| Event | Fires | `req.data` contains |
|---|---|---|
| `PIPELINE.READ` | Once per run, before batch iteration | `config`, `source`, `target` → handler sets `sourceStream` (async iterable) |
| `PIPELINE.MAP` | Once per batch | `sourceRecords`, `targetRecords` (handler fills `targetRecords`) |
| `PIPELINE.WRITE` | Once per batch, after MAP | `targetRecords` (handler writes and sets `statistics`) |

Hooks register via the standard CAP API: `srv.before/on/after(event, pipelineName, handler)`.

!!! note "Signature convention"
    Per CAP convention: `before` and `on` hooks receive `(req)`; `after` hooks receive `(results, req)`. For non-READ events `results` is usually `undefined`, so `after` hooks should read and mutate state on the second argument (`req.data`).

!!! note "Ordering"
    Multiple hooks for the same `(event, path)` run in parallel via `Promise.all`. If you need sequential ordering, use `srv.prepend(() => srv.before(...))`.

## See also

- [Reference → Features](features.md) — consumer-facing capability overview for the engine.
- [Concepts → Terminology](../concepts/terminology.md) — the event namespace and tracker primitives.
- [Concepts → Inference rules](../concepts/inference.md) — how `addPipeline(...)` derives behavior from the config shape.

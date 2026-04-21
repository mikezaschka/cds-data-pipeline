# cds-data-pipeline

> **Work in progress.** This is a WIP version — APIs, schema, and documentation are still evolving and may change before a stable release.

[Documentation](https://mikezaschka.github.io/cds-data-pipeline/) · [npm](https://www.npmjs.com/package/cds-data-pipeline)

**`cds-data-pipeline` is a CAP application-layer plugin for declarative, traceable, scheduled data pipelines between CAP services.** Each pipeline is a linear `READ → MAP → WRITE` job between exactly one source and one target, with built-in tracker, retry, concurrency guard, management OData API, and event hooks. It sits above ad-hoc `cds.spawn` replication (which lacks production characteristics) and below SAP Integration Suite / SDI / SLT (which solve cross-system, cross-protocol, out-of-process problems). It does not compose pipelines, does not join across sources, does not ship a visual modeler.

## What this is

- A programmatic `addPipeline({ name, source, target, mode, delta, schedule, ... })` API that registers one pipeline per call. Behaviour is inferred from the config shape — there is no stored pipeline-kind discriminator.
- A `cds.Service` (`DataPipelineService`) routing `PIPELINE.READ` → `PIPELINE.MAP` → `PIPELINE.WRITE` events through CAP's single-winner `on` handler model, with hook registration via the standard `srv.before / on / after(event, pipelineName, handler)` API.
- A persisted tracker (`Pipelines`, `PipelineRuns`) + management OData service at `/pipeline` (`DataPipelineManagementService`).
- Source adapters: OData V2 / V4, REST (offset / cursor / page pagination), CQN (in-process CAP services and CQN-native DB bindings), pluggable `BaseSourceAdapter`.
- Target adapters: `DbTargetAdapter` (local DB) and `ODataTargetAdapter` (remote OData V2 / V4 via CAP's connected service) shipped in-box; pluggable `BaseTargetAdapter` for everything else.
- Resilience primitives: `withRetry()` with exponential backoff, concurrency guard via optimistic UPDATE on the tracker.

## What this isn't

- **Not a DAG runner.** Each `addPipeline(...)` call wires one source to one target — the engine never chains, composes, or fans out internally. "Fan-in" in the DAG sense (one engine call merging multiple sources in-process) is out of scope; consolidating the same logical entity from N backends into one target table **is** supported by registering N sibling pipelines and stamping a `source.origin` label into a shared `source` key column — see [Recipes → Multi-source fan-in](https://mikezaschka.github.io/cds-data-pipeline/recipes/multi-source/).
- **Not an ETL engine.** No multi-source joins inside the pipeline.
- **Not a transformation DSL.** Field renames happen in the `MAP` event hook (or via the caller-supplied `viewMapping.remoteToLocal`). Anything more complex is application code.
- **Not an iPaaS.** No visual modeler, no adapter marketplace, no cross-tenant control plane.
- **Not CDC.** Delta modes are polling-based (timestamp / key / datetime-fields). Log-based change capture (Debezium et al.) is below the app layer.
- **Not a replacement for enterprise integration / data-movement tooling.** Cross-system, cross-protocol, visually-modeled, operationally-managed movement belongs in **SAP Integration Suite (Cloud Integration)**, **SAP Datasphere replication flows**, **SAP HANA Smart Data Integration (SDI)**, **SAP Landscape Transformation (SLT)**, or **SAP Data Intelligence**. This plugin is strictly application-layer — it moves data between CAP-addressable services from inside one CAP app, using CAP's own `cds.connect.to`, destinations, and credentials.

## Use cases

Three common combinations of read shape and target destination. These are **doc-level labels**, not a field on `addPipeline(...)` and not a column on the tracker — the engine dispatches through source / target adapter factories instead. See the [Inference rules](https://mikezaschka.github.io/cds-data-pipeline/concepts/inference/) for the full table.

| Use case | Config shape | Status |
|---|---|---|
| **Replicate** | `source.entity` (or `rest.path`) present, `source.query` absent, target is `db`. Row-preserving copy — one source row → one target row (possibly filtered, projected, renamed). | **Shipped.** Routes writes through `DbTargetAdapter`. |
| **Materialize** | `source.query` present. Target derived from a SELECT CQN closure (aggregates, joins, DISTINCT, computed columns). Full refresh or scoped partial refresh via `refresh.slice`. | **Shipped** for CQN-native sources. Routes writes through `DbTargetAdapter`. |
| **Move-to-service** | Entity-shape read to a non-`db` `target.service`. | **Shipped** for OData targets — set `target.service` to an OData-kind remote (or pass `target.kind: 'odata'`) and the factory resolves `ODataTargetAdapter`. Other transports require a custom [`BaseTargetAdapter`](https://mikezaschka.github.io/cds-data-pipeline/targets/custom/) (or a `PIPELINE.WRITE` override); un-adaptered non-`db`, non-OData targets are rejected at registration. |

## Install

```bash
npm add cds-data-pipeline
```

Peer dependencies:

- `@sap/cds` >= 8 (required)

The plugin auto-activates on load via `cds-plugin.js`.

## Database schema

The engine ships CDS for the `Pipelines` / `PipelineRuns` tracker tables under `db/index.cds` (namespace `plugin.data_pipeline`). Schema management follows the standard CAP lifecycle:

- **Local / SQLite** — run `cds deploy` (or let the CAP dev runtime bootstrap the schema from the bound profile).
- **HANA HDI** — the HDI container owns the schema. Include the engine's CDS model in your consumer build (`cds build --production`) and deploy via `cf push` or the HDI deployer. The plugin does no runtime DDL.

## Programmatic API

```javascript
const cds = require('@sap/cds');

const pipelines = await cds.connect.to('DataPipelineService');

// Register a pipeline. Behaviour is inferred from the config shape — `source.entity`
// + db target → entity-shape (replicate use case) with mode 'delta'.
// See https://mikezaschka.github.io/cds-data-pipeline/concepts/inference/
await pipelines.addPipeline({
    name: 'BusinessPartners',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.BusinessPartners' },
    delta: { field: 'modifiedAt', mode: 'timestamp' },
    schedule: 600000, // every 10 minutes
});

// Hooks use CAP's standard pattern.
pipelines.before('PIPELINE.MAP', 'BusinessPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});

// Run on demand
await pipelines.run('BusinessPartners');
```

### Event hooks

Pipeline events are namespaced to avoid collision with CAP's CRUD aliases (`READ`, `WRITE`). `DataPipelineService` is a standard `cds.Service` — resolve it via `cds.connect.to('DataPipelineService')` and register hooks with CAP's native `srv.before / on / after(event, pipelineName, handler)` API.

| Event | Fires | `req.data` |
|---|---|---|
| `PIPELINE.READ` | Once per run, before batch iteration | `config`, `source`, `target` → handler sets `sourceStream` (async iterable) |
| `PIPELINE.MAP` | Once per batch | `sourceRecords`, `targetRecords` (handler fills `targetRecords`) |
| `PIPELINE.WRITE` | Once per batch, after MAP | `targetRecords` (handler writes and sets `statistics`) |

```javascript
// Filter out blocked records before MAP (before hooks receive the request only)
pipelines.before('PIPELINE.MAP', 'BusinessPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});

// Custom MAP — overrides the built-in rename mapping from a consumption view
pipelines.on('PIPELINE.MAP', 'BusinessPartners', async (req) => {
    req.data.targetRecords = req.data.sourceRecords.map(record => ({
        ID: record.BusinessPartner,
        name: record.BusinessPartnerFullName,
        sourceService: req.data.source.service,
    }));
});

// Enrich after MAP (after hooks receive `(results, req)` per CAP convention)
pipelines.after('PIPELINE.MAP', 'BusinessPartners', async (_results, req) => {
    req.data.targetRecords = req.data.targetRecords.map(r => ({
        ...r,
        classification: classify(r),
    }));
});
```

**Signature note.** CAP convention: `before` and `on` hooks receive `(req)`; `after` hooks receive `(results, req)`. For non-READ events `results` is usually `undefined`, so `after` hooks should read and mutate state on the second argument (`req.data`).

**Ordering note.** Multiple hooks for the same `(event, path)` run in parallel via `Promise.all`. If you need sequential ordering, register with `srv.prepend(() => srv.before(...))`.

## CQL limitations on remote (OData) services

These are CAP-platform limitations when routing CQL to OData, surfaced here because the engine's OData source adapters inherit them. Everything else works through the adapter pipeline.

| CQL feature | Reason | Workaround |
|---|---|---|
| `.where({ field: { like: '%X%' } })` | OData `$filter` has no `like` keyword | Use `contains(...)`, `startswith(...)`, `endswith(...)` via HTTP `$filter` |
| `SELECT.distinct` | CAP's `cqn2odata` rejects `.distinct` | Deduplicate in pipeline MAP hook, or replicate and query the local copy |
| `.groupBy()` / `.having()` / `$apply` | CAP rejects aggregation on remote services | Aggregate in-app, or replicate and use local SQL |
| `forUpdate()` / `forShareLock()` | DB concept, not OData | Use ETags for optimistic concurrency |

## Management service

OData service at `/pipeline` (`DataPipelineManagementService`):

- `GET /pipeline/Pipelines` — configuration + statistics per pipeline.
- `GET /pipeline/PipelineRuns` — per-run timing, trigger, status, statistics.
- `POST /pipeline/run` — `{ name, mode?, trigger?, async? }` — run a pipeline. Used by scripts, tests, and external schedulers (SAP BTP Job Scheduling Service, Kubernetes `CronJob`, ...). Protected by the `PipelineRunner` scope.
- `POST /pipeline/flush` — `{ name }` — reset tracker + clear target output.
- `GET /pipeline/status(name='...')` — single tracker record.

## Scheduling

Pick one of three drive models per pipeline (mix freely across pipelines in the same app):

- **Omit `schedule`** and trigger externally via `POST /pipeline/run`. Recommended for BTP-native ops — see the [SAP BTP Job Scheduling Service recipe](https://mikezaschka.github.io/cds-data-pipeline/recipes/external-scheduling-jss/).
- **`schedule: 600000`** (or `{ every, engine: 'spawn' }`) — in-process timer via `cds.spawn({ every })`. Best-effort, fires on every app instance. Good for dev and single-instance deployments.
- **`schedule: { every: '10m', engine: 'queued' }`** — persistent task queue via `cds.queued(srv).schedule(...).every(...)`. Single-winner across instances, survives restarts, retry + dead-letter. Underlying CAP API is experimental. See the [queued scheduling recipe](https://mikezaschka.github.io/cds-data-pipeline/recipes/internal-scheduling-queued/).

## Documentation

Full documentation — concepts, recipes, adapter references, and the management service API — is available at <https://mikezaschka.github.io/cds-data-pipeline/>.

---

> **Note on SAP data extraction.** `@sap/cds` ships under the [SAP Developer License Agreement (3.2 CAP)](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP.txt). §1 requires that Customer Applications will not "permit mass data extraction from an SAP product to a non-SAP product, including use, modification, saving or other processing of such data in the non-SAP product, except and only to the extent that the extraction is solely used for and required for interoperability with an SAP product." When you point a pipeline at an SAP source, keep it inside that interoperability carve-out.

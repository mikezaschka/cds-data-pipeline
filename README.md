# cds-data-pipeline

> **Work in progress.** This is a WIP version — APIs, schema, and documentation are still evolving and may change before a stable release.

[Documentation](https://mikezaschka.github.io/cds-data-pipeline/) · [npm](https://www.npmjs.com/package/cds-data-pipeline)

**`cds-data-pipeline` is a CAP application-layer plugin for declarative, traceable, scheduled data pipelines between CAP services.** Each pipeline is a linear `READ → MAP → WRITE` job between exactly one source and one target, with built-in tracker, retry, concurrency guard, management OData API, and event hooks. It sits above ad-hoc `cds.spawn` replication (which lacks production characteristics) and below SAP Integration Suite / SDI / SLT (which solve cross-system, cross-protocol, out-of-process problems). It does not compose pipelines, does not join across sources, does not ship a visual modeler.

## What this is

- A programmatic `addPipeline({ name, source, target, mode, delta, schedule, ... })` API that registers one pipeline per call. Behaviour is [inferred from the config shape](https://mikezaschka.github.io/cds-data-pipeline/guide/concepts/inference.html).
- A `cds.Service` (`DataPipelineService`) routing `PIPELINE.START` → `PIPELINE.READ` → (`PIPELINE.MAP_BATCH` → `PIPELINE.WRITE_BATCH`)\* → `PIPELINE.DONE` events, with hook registration via the standard `srv.before / on / after(event, pipelineName, handler)` API.
- A persisted tracker (`Pipelines`, `PipelineRuns`) + [management OData service](https://mikezaschka.github.io/cds-data-pipeline/reference/management-service.html) at `/pipeline` (`DataPipelineManagementService`).
- Source adapters: [OData V2 / V4](https://mikezaschka.github.io/cds-data-pipeline/guide/sources/odata.html), [REST](https://mikezaschka.github.io/cds-data-pipeline/guide/sources/rest.html) (offset / cursor / page pagination), [CQN](https://mikezaschka.github.io/cds-data-pipeline/guide/sources/cqn.html) (in-process CAP services and CQN-native DB bindings), pluggable [`BaseSourceAdapter`](https://mikezaschka.github.io/cds-data-pipeline/guide/sources/custom.html).
- Target adapters: [`DbTargetAdapter`](https://mikezaschka.github.io/cds-data-pipeline/guide/targets/db.html) (local DB) and [`ODataTargetAdapter`](https://mikezaschka.github.io/cds-data-pipeline/guide/targets/odata.html) (remote OData V2 / V4 via CAP's connected service) shipped in-box; pluggable [`BaseTargetAdapter`](https://mikezaschka.github.io/cds-data-pipeline/guide/targets/custom.html) for everything else.
- Resilience primitives: retry with exponential backoff and a concurrency guard on the tracker.

## What this isn't

- **Not a DAG runner.** Each `addPipeline(...)` call wires one source to one target — pipelines never chain, compose, or fan out internally. "Fan-in" in the DAG sense (one call merging multiple sources in-process) is out of scope; consolidating the same logical entity from N backends into one target table **is** supported by registering N sibling pipelines and stamping a `source.origin` label into a shared `source` key column — see [Recipes → Multi-source fan-in](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/multi-source.html).
- **Not an ETL engine.** No multi-source joins inside the pipeline.
- **Not a transformation DSL.** Field renames happen in the `MAP` event hook (or via the caller-supplied `viewMapping.remoteToLocal`). Anything more complex is application code.
- **Not an iPaaS.** No visual modeler, no adapter marketplace, no cross-tenant control plane.
- **Not CDC.** Delta modes are polling-based (timestamp / key / datetime-fields). Log-based change capture (Debezium et al.) is below the app layer.
- **Not a replacement for enterprise integration / data-movement tooling.** Cross-system, cross-protocol, visually-modeled, operationally-managed movement belongs in **SAP Integration Suite (Cloud Integration)**, **SAP Datasphere replication flows**, **SAP HANA Smart Data Integration (SDI)**, **SAP Landscape Transformation (SLT)**, or **SAP Data Intelligence**. This plugin is strictly application-layer — it moves data between CAP-addressable services from inside one CAP app, using CAP's own `cds.connect.to`, destinations, and credentials.

## Use cases

Common combinations of read shape and target destination. These are **doc-level labels**, not a field on `addPipeline(...)` and not a column on the tracker. See the [Inference rules](https://mikezaschka.github.io/cds-data-pipeline/guide/concepts/inference.html) for the full table.

| Use case | What it does | Recipe |
|---|---|---|
| **Replicate** | Entity-shape read, row-preserving copy into a local DB target — one source row → one target row (possibly filtered, projected, renamed). | [Built-in replicate](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/built-in-replicate.html) |
| **Materialize** | Query-shape read (`source.query`). Target derived from a SELECT CQN closure — aggregates, joins, DISTINCT, computed columns. Full refresh or scoped partial refresh via `refresh.slice`. | [Built-in materialize](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/built-in-materialize.html) |
| **Move-to-service** | Entity-shape read into a non-`db` target. Built-in for OData targets; other transports via a [custom target adapter](https://mikezaschka.github.io/cds-data-pipeline/guide/targets/custom.html) or [event hooks](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/event-hooks.html). | [Built-in replicate → OData target](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/built-in-replicate.html#to-a-remote-odata-target) |
| **Multi-source fan-in** | Consolidate the same logical entity from N backends into one target table via sibling pipelines, each stamping a `source.origin` label into a shared `source` key column. | [Multi-source fan-in](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/multi-source.html) |

## Features

A teaser of what the plugin offers. Full catalogue on the [Features reference page](https://mikezaschka.github.io/cds-data-pipeline/reference/features.html).

- **Source adapters** — [OData V2 / V4](https://mikezaschka.github.io/cds-data-pipeline/guide/sources/odata.html), [REST](https://mikezaschka.github.io/cds-data-pipeline/guide/sources/rest.html) (cursor / offset / page pagination, `dataPath` extraction), [CQN](https://mikezaschka.github.io/cds-data-pipeline/guide/sources/cqn.html) (in-process CAP services and DB bindings), plus a pluggable [`BaseSourceAdapter`](https://mikezaschka.github.io/cds-data-pipeline/guide/sources/custom.html) for anything else.
- **Target adapters** — [local DB](https://mikezaschka.github.io/cds-data-pipeline/guide/targets/db.html) (default), [remote OData V2 / V4](https://mikezaschka.github.io/cds-data-pipeline/guide/targets/odata.html), and a pluggable [`BaseTargetAdapter`](https://mikezaschka.github.io/cds-data-pipeline/guide/targets/custom.html) for non-db / non-OData destinations.
- **Delta modes** — polling-based `timestamp` / `key` / `datetime-fields` for entity-shape reads; `full` and `partial-refresh` for query-shape. See [Inference rules](https://mikezaschka.github.io/cds-data-pipeline/guide/concepts/inference.html).
- **Consumption views** — declare the target as a `projection on <remote.Entity>` annotated with `@cds.persistence.table`. One CDS declaration defines schema, column restriction, rename mapping, and filter. See [Consumption views](https://mikezaschka.github.io/cds-data-pipeline/guide/concepts/consumption-views.html).
- **Event hooks** — lifecycle events `PIPELINE.START` / `PIPELINE.DONE` bracket each run; `PIPELINE.READ` / `PIPELINE.MAP_BATCH` / `PIPELINE.WRITE_BATCH` drive the phases. Via CAP's native `before / on / after` API. See [Event hooks](https://mikezaschka.github.io/cds-data-pipeline/reference/management-service.html#event-hooks).
- **Scheduling** — in-process `spawn`, cross-instance persistent [`queued` engine](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/internal-scheduling-queued.html), or external drive via [SAP BTP Job Scheduling Service](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/external-scheduling-jss.html) / Kubernetes `CronJob`.
- **Management OData service** — [`Pipelines`, `PipelineRuns`, `execute`, bound `start`, `flush`, `status`](https://mikezaschka.github.io/cds-data-pipeline/reference/management-service.html) at `/pipeline`.
- **Observability** — per-pipeline tracker, per-run history, `created` / `updated` / `deleted` / `skipped` statistics, optional request-level snapshots. See [Features → Observability](https://mikezaschka.github.io/cds-data-pipeline/reference/features.html#observability).
- **Resilience** — retry with exponential backoff, concurrency guard, and per-batch or per-run transaction scope.
- **Plugin entry points** — four extension points, ordered by how much code you write: built-in adapters (no code), [custom source adapter](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/custom-source-adapter.html), [custom target adapter](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/custom-target-adapter.html), [`PIPELINE.*` event hooks](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/event-hooks.html).

## Install

```bash
npm add cds-data-pipeline
```

Peer dependencies:

- `@sap/cds` >= 9.2 (required)

The plugin activates automatically once installed.

## Database schema

The plugin ships CDS for the `Pipelines` / `PipelineRuns` tracker tables under namespace `plugin.data_pipeline`. Schema management follows the standard CAP lifecycle:

- **Local / SQLite** — run `cds deploy` (or let the CAP dev runtime bootstrap the schema from the bound profile).
- **HANA HDI** — the HDI container owns the schema. Include the plugin's CDS model in your consumer build (`cds build --production`) and deploy via `cf push` or the HDI deployer. No runtime DDL is performed.

## Tests (this repository)

Integration and unit tests live under `test/`. The layout is:

- `test/fixtures/consumer` — CAP consumer app (workspace package) with `register-fixture-pipelines.js` loaded when `CDS_PIPELINE_TEST_CONSUMER=true` (set by Jest `setupFiles`).
- `test/fixtures/provider`, `inventory-provider`, `rest-provider` — sibling workspace packages that mock OData / REST backends.
- `test/support` — Jest env bootstrap, provider spawn helpers, shared helpers (`waitForConsumerFixturePipelines`, …).
- `test/unit`, `test/integration` — Jest suites.

From the repo root (npm workspaces install deps once):

```bash
npm test              # all tests
npm run test:unit     # unit only
npm run test:integration
```

Consumers of the published package only need the usual `cds deploy` + `using from 'cds-data-pipeline/db'` (or equivalent) so tracker tables exist; the Jest-only env flag and `test/` tree are not shipped on npm.

## Programmatic API

```javascript
const cds = require('@sap/cds');

const pipelines = await cds.connect.to('DataPipelineService');

// Register a pipeline. Behaviour is inferred from the config shape — `source.entity`
// + db target → entity-shape (replicate use case) with mode 'delta'.
// See https://mikezaschka.github.io/cds-data-pipeline/guide/concepts/inference.html
await pipelines.addPipeline({
    name: 'BusinessPartners',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.BusinessPartners' },
    delta: { field: 'modifiedAt', mode: 'timestamp' },
    schedule: 600000, // every 10 minutes
});

// Hooks use CAP's standard pattern.
pipelines.before('PIPELINE.MAP_BATCH', 'BusinessPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});

// Run on demand — blocking
await pipelines.execute('BusinessPartners');

// Or fire-and-forget; `done` resolves when the run finishes
const { runId, done } = await pipelines.execute('BusinessPartners', { async: true });
done.then(({ status, statistics }) => console.log(runId, status, statistics));
```

Full event-hook surface (signatures, ordering, `req.data` payload per phase) is on the [Management Service reference page](https://mikezaschka.github.io/cds-data-pipeline/reference/management-service.html#event-hooks).

## Management service

OData service at `/pipeline` (`DataPipelineManagementService`) — full reference on the [Management Service page](https://mikezaschka.github.io/cds-data-pipeline/reference/management-service.html).

- `GET /pipeline/Pipelines` — configuration + statistics per pipeline.
- `GET /pipeline/PipelineRuns` — per-run timing, trigger, status, statistics.
- `POST /pipeline/execute` — `{ name, mode?, trigger?, async? }` — run a pipeline. Used by scripts, tests, and external schedulers (SAP BTP Job Scheduling Service, Kubernetes `CronJob`, ...).
- `POST /pipeline/Pipelines('<name>')/DataPipelineManagementService.start` — same run as `execute`, bound to the `Pipelines` instance (typical for Fiori object-page actions). See the [management service reference](https://mikezaschka.github.io/cds-data-pipeline/reference/management-service.html).
- `POST /pipeline/flush` — `{ name }` — reset tracker + clear target output.

Authorization for `/pipeline` is **not** defined by the plugin: add `@(requires: …)`, XSUAA, and routing rules in your own application.
- `GET /pipeline/status(name='...')` — single tracker record.

## Scheduling

Pick one of three drive models per pipeline (mix freely across pipelines in the same app):

- **Omit `schedule`** and trigger externally via `POST /pipeline/execute`. Recommended for BTP-native ops — see the [SAP BTP Job Scheduling Service recipe](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/external-scheduling-jss.html).
- **`schedule: 600000`** (or `{ every, engine: 'spawn' }`) — in-process timer via `cds.spawn({ every })`. Best-effort, fires on every app instance. Good for dev and single-instance deployments.
- **`schedule: { every: '10m', engine: 'queued' }`** — persistent task queue via `cds.queued(srv).schedule(...).every(...)`. Single-winner across instances, survives restarts, retry + dead-letter. Underlying CAP API is experimental. See the [queued scheduling recipe](https://mikezaschka.github.io/cds-data-pipeline/guide/recipes/internal-scheduling-queued.html).

## Documentation

Full documentation — concepts, recipes, adapter references, and the management service API — is available at <https://mikezaschka.github.io/cds-data-pipeline/>.

---

> **Note on SAP data extraction.** `@sap/cds` ships under the [SAP Developer License Agreement (3.2 CAP)](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP.txt). §1 requires that Customer Applications will not "permit mass data extraction from an SAP product to a non-SAP product, including use, modification, saving or other processing of such data in the non-SAP product, except and only to the extent that the extraction is solely used for and required for interoperability with an SAP product." When you point a pipeline at an SAP source, keep it inside that interoperability carve-out.

# Inference rules and registration validation

`addPipeline(...)` infers pipeline behavior from the shape of `source` and `target`. There is **no `kind` argument** — passing one has no effect. The engine dispatches through two factories (source-adapter and target-adapter); nothing in the hot path branches on a stored discriminator.

"Replicate", "materialize", and "move-to-service" remain useful **use-case labels** in the recipes and README — they name three common combinations of read shape and target destination — but they are documentation vocabulary, not a runtime enum.

## Inference rules

### Read shape

| Config | Read shape | Inferred defaults |
|---|---|---|
| `source.query` present | **Query-shape** — single-shot read of the closure's SELECT CQN result. | `mode: 'full'`, `delta.mode: 'full'`, `refresh: 'full'` |
| `source.entity` (or `rest.path`) present, `source.query` absent | **Entity-shape** — paginated `readStream(tracker)` via the source adapter. | `mode: 'delta'`, `delta.mode: 'timestamp'`, `delta.field: 'modifiedAt'` |
| Both present | Error — ambiguous source shape. |  |
| Neither present | Error — missing source shape. |  |

### Target dispatch

The target adapter is resolved by the factory in `srv/adapters/targets/factory.js`:

| Config | Resolved target adapter |
|---|---|
| `target.adapter: MyTargetAdapter` (class ref) | Instantiates the supplied class. Factory skips the service-based dispatch. |
| `target.service` unset or `'db'` | `DbTargetAdapter` — writes via `cds.connect.to('db')`. |
| `target.service` set to any other value with no `target.adapter` | **Error** — no built-in adapter for non-`db` services. See [Custom target adapter](../targets/custom.md). |

This replaces the pre-capability-layer behaviour where `target.service = 'SomeRemoteService'` used to register silently and fall through to local DB writes. Registering an un-adaptered non-`db` target now fails fast.

## Registration validation matrix

`_validateConfig` and `_validateTargetCapabilities` in `DataPipelineService` reject incoherent configs at registration time. Every row is grounded in a concrete conflict between config and adapter capability.

| # | Config conflict | Engine response |
|---|---|---|
| 1 | `source.query` AND `source.entity` (or `rest.path`) both set | Error — ambiguous source shape |
| 2 | neither `source.query` nor `source.entity` / `rest.path` | Error — missing source shape |
| 3 | `source.query` + `mode: 'delta'` | Error — row-delta requires entity-shape source; use `'full'` or `'partial-refresh'` |
| 4 | `source.query` + `delta.mode: 'timestamp' \| 'key' \| 'datetime-fields'` | Error — timestamp / key / datetime-delta requires entity-shape source |
| 5 | `mode: 'partial-refresh'` (or `refresh: { mode: 'partial' }`) without `refresh.slice` | Error — `slice` closure required for partial-refresh |
| 6 | `mode: 'delta'` + target adapter lacks `keyAddressableUpsert` | Error — target cannot UPSERT per key; use `'full'` or pick a different target |
| 7 | `mode: 'full'` + target adapter lacks `truncate` **and** `batchDelete` | Error — target cannot clear the slice for full refresh |
| 8 | `source.query` + target adapter lacks `batchInsert` | Error — target cannot accept snapshot writes |
| 9 | `source.origin` + `source.query` | Error — materialize (query-shape) rebuilds the snapshot and is origin-agnostic |
| 10 | `source.origin` + target entity missing `key source : String` (aspect `plugin.data_pipeline.sourced`) | Error — stamp has nowhere to land; import the aspect from `cds-data-pipeline/db` |

Rows 6–8 are evaluated against the `capabilities()` object advertised by the resolved `TargetAdapter`. The default `DbTargetAdapter` reports all four capabilities as `true`, so the standard DB-backed path is unaffected.

Rows 9–10 cover the multi-source fan-in rules. See the [Multi-source](../recipes/multi-source.md) recipe for the end-to-end pattern.

## Multi-source (origin stamp)

`source.origin` is **orthogonal** to the inferred pipeline kind: it is a bare label that the default MAP / WRITE handlers stamp into the target's `source` key column. It composes with the entity-shape cases (replicate, move-to-service) and is rejected against query-shape (materialize) because snapshot rebuilds ignore per-row discriminators.

| Read shape | `source.origin` set | Outcome |
|---|---|---|
| Entity-shape (replicate / move-to-service) | yes | Default MAP writes `record.source = origin`; UPSERT uses the compound key `(businessKey, source)`; `flush` and `mode: 'full'` scope their DELETE to `source = <origin>` |
| Entity-shape | no | Legacy single-origin behavior — no stamp, full-table truncate on flush / `mode: 'full'` |
| Query-shape (materialize) | yes | **Rejected at registration** (row 9 above) |
| Query-shape | no | Legacy materialize — snapshot rebuilds the whole target per `refresh` scope |

The target entity must mix in the `plugin.data_pipeline.sourced` aspect (or declare `key source : String(N)` directly) whenever any pipeline writes an origin into it; this is row 10 of the validation matrix. See [Multi-source fan-in](../recipes/multi-source.md) for the aspect import, association-`source` extension, and per-origin flush assertion.

## Examples

### Entity-shape replicate to local DB

```javascript
await pipelines.addPipeline({
    name: 'OrdersCopy',
    source: { service: 'reporting', entity: 'reporting.Orders' },
    target: { entity: 'db.ArchivedOrders' },
    delta: { mode: 'timestamp', field: 'modifiedAt' },
});
// Inferred: mode=delta, delta.mode=timestamp, target adapter=DbTargetAdapter.
```

### Query-shape materialize

```javascript
await pipelines.addPipeline({
    name: 'DailyCustomerRevenue',
    source: {
        kind: 'cqn',
        service: 'SalesService',
        query: () => SELECT.from('SalesService.Orders')
            .columns('customer_id',
                { func: 'sum', args: [{ ref: ['amount'] }], as: 'total' })
            .groupBy('customer_id'),
    },
    target: { entity: 'reporting.DailyCustomerRevenue' },
});
// Inferred: mode=full, refresh=full, target adapter=DbTargetAdapter.
```

### Entity-shape to a custom target adapter

```javascript
const ReportingTargetAdapter = require('./adapters/ReportingTargetAdapter');

await pipelines.addPipeline({
    name: 'OrdersToReporting',
    source: { service: 'OrdersService', entity: 'Orders' },
    target: {
        service: 'ReportingService',
        entity: 'ReportingService.OrderFacts',
        adapter: ReportingTargetAdapter,
    },
});
// Inferred: mode=delta, target adapter=ReportingTargetAdapter. The custom
// adapter's capabilities() decides which modes are accepted.
```

See [Custom target adapter](../targets/custom.md) for how to implement `ReportingTargetAdapter`.

## Observability

At registration the engine emits one log line per pipeline, composed from the inference above:

```
[cds-data-pipeline] registered 'OrdersCopy' — entity-shape from reporting.reporting.Orders → db.db.ArchivedOrders, mode=delta(timestamp modifiedAt), adapter=CqnAdapter
```

The line names the read shape, source and target references, the effective mode + delta mode, and the source adapter class resolved for the READ phase — so the inference is visible without reading any documentation.

When `source.origin` is set, the line gains a trailing `, origin=<label>` so multi-source setups are self-documenting in the startup log:

```
[cds-data-pipeline] registered 'BP_DEV' — entity-shape from API_BP_DEV.A_BusinessPartner → db.BusinessPartners, mode=delta(timestamp modifiedAt), adapter=ODataAdapter, origin=DEV
```

## See also

- [Recipes → Built-in replicate](../recipes/built-in-replicate.md), [Built-in materialize](../recipes/built-in-materialize.md), [Custom target adapter](../recipes/custom-target-adapter.md), [Write-hook override](../recipes/write-hook-override.md)
- [Concepts → Terminology](terminology.md)
- [Sources → CQN adapter](../sources/cqn.md)
- [Sources → Custom source adapter](../sources/custom.md) · [Targets → Custom target adapter](../targets/custom.md)

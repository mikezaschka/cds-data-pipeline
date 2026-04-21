---
hide:
  - navigation
---

# Targets

The **target** side of a pipeline owns the `PIPELINE.WRITE` phase plus the pre-write clear (`truncate` / `deleteSlice`) that full-refresh and partial-refresh modes need. A target adapter advertises its `capabilities()` so the engine can reject incompatible configs at registration time rather than halfway through the first run.

The engine never calls `cds.connect.to('db')` directly from the hot path. Every write is dispatched through the resolved target adapter, and the factory in `srv/adapters/targets/factory.js` refuses to silently fall back to the local DB for un-adaptered non-`db` targets.

## Factory resolution order

`addPipeline(...)` resolves the target adapter in this order:

1. `config.target.adapter` — class reference extending `BaseTargetAdapter`. Full control; skips the service-based dispatch.
2. `config.target.service` unset or `'db'` → built-in `DbTargetAdapter`.
3. `config.target.kind` (`'odata' | 'odata-v2'`) — explicit transport selector. Wins over the connected service's auto-detected kind.
4. Auto-detected `service.options.kind` (`'odata' | 'odata-v2'`) on the connected remote service → built-in `ODataTargetAdapter`.
5. Any other `config.target.service` with no `target.adapter` → **registration error** pointing to [Custom target adapter](custom.md). The factory does not silently fall back to the local DB.

## Built-in target adapters

| Adapter | Resolved when | Capabilities | Page |
|---|---|---|---|
| `DbTargetAdapter` | `target.service` unset or `'db'` | `batchInsert`, `keyAddressableUpsert`, `batchDelete`, `truncate` | [Local DB](db.md) |
| `ODataTargetAdapter` | `target.kind` is `'odata' / 'odata-v2'`, or the connected service advertises that kind | `batchInsert`, `keyAddressableUpsert`, `batchDelete`, `truncate` | [OData](odata.md) |
| Any other transport | Register a [custom target adapter](custom.md) | Whatever the adapter advertises |  |

<div class="grid cards" markdown>

-   :material-database: **Local DB**

    ---

    The default. Resolved automatically when `target.service` is unset or `'db'`. Writes `UPSERT` / `INSERT` / `DELETE` via CAP's `cds.connect.to('db')`.

    [:octicons-arrow-right-24: Local DB](db.md)

-   :material-cloud-upload: **OData**

    ---

    Forward writes to a remote OData V2 / V4 service through CAP's remote runtime — `UPSERT.entries(...)` → POST / PUT / PATCH, with `$batch` change sets where the provider supports them.

    [:octicons-arrow-right-24: OData](odata.md)

-   :material-puzzle: **Custom target adapter**

    ---

    Extend `BaseTargetAdapter` for non-db, non-OData destinations (message buses, custom HTTP APIs, …). Worked example: a reporting service over `srv.send()`.

    [:octicons-arrow-right-24: Custom target adapter](custom.md)

</div>

## Capability gating

Registration (`DataPipelineService._validateTargetCapabilities`) rejects incompatible configs by consulting the target adapter's `capabilities()`:

| Config | Required capability |
|---|---|
| `mode: 'delta'` | `keyAddressableUpsert` |
| `mode: 'full'` | `truncate` **or** `batchDelete` |
| `source.query` (query-shape) | `batchInsert` |

Omitted keys default to `false`. Advertise only what your adapter actually supports — the engine will reject users at `addPipeline(...)` rather than halfway through the first run. The default `DbTargetAdapter` reports all four capabilities as `true`, so the standard DB-backed path is unaffected.

## Transactional semantics

The engine wraps the WRITE loop in a `cds.tx` transaction only for query-shape (snapshot) pipelines — so `truncate` / `deleteSlice` + batch `INSERT`s commit atomically and a mid-run crash leaves the previous snapshot intact. Entity-shape (UPSERT) pipelines run without an outer transaction: each batch commits on its own so partial progress survives interruptions.

Target adapters do not have to manage `cds.tx` themselves; they inherit the ambient `cds.context` / transaction from the engine. Custom remote-protocol adapters (e.g. a reporting-service adapter) need to surface their own atomicity guarantees at the service boundary — the engine's `cds.tx` does not span remote HTTP calls.

## See also

- [Concepts → Inference rules](../concepts/inference.md) — target dispatch and the full capability-gated registration matrix.
- [Sources](../sources/index.md) — the peer section covering the READ phase.
- [Recipes → Custom target adapter](../recipes/custom-target-adapter.md) — end-to-end reporting-service example.

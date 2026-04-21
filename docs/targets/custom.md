# Custom target adapter

When the destination is not the local DB (`'db'`) and not an OData service (`'odata'` / `'odata-v2'`), the factory in `srv/adapters/targets/factory.js` will refuse to register the pipeline unless you supply a `target.adapter` class reference. Write one by extending `BaseTargetAdapter`.

The engine calls four methods on the adapter — three write primitives plus the capability-advertisement hook it consults at registration.

## Contract

```javascript
const BaseTargetAdapter = require('cds-data-pipeline/srv/adapters/targets/BaseTargetAdapter');

class MyTargetAdapter extends BaseTargetAdapter {
    async writeBatch(records, { mode, target }) {
        // mode: 'upsert' (entity-shape) | 'snapshot' (query-shape INSERT
        // after engine-driven clear). target: { service?, entity }.
        // Return { created, updated, deleted } for the tracker.
    }

    async truncate(target) {
        // Full-refresh clear. Called from _fullSync and from
        // _prepareMaterializeTarget when refresh === 'full'.
    }

    async deleteSlice(target, predicate) {
        // Partial-refresh clear. `predicate` is the CQN where-shape
        // returned by refresh.slice(tracker).
    }

    capabilities() {
        return {
            batchInsert: false,        // INSERT many rows in one call
            keyAddressableUpsert: false, // UPSERT by key (delta writes)
            batchDelete: false,        // DELETE WHERE <predicate>
            truncate: false,           // DELETE all rows
        };
    }
}
```

## Capability gating

Registration (`DataPipelineService._validateTargetCapabilities`) rejects incompatible configs by consulting `capabilities()`:

| Config | Required capability |
|---|---|
| `mode: 'delta'` | `keyAddressableUpsert` |
| `mode: 'full'` | `truncate` **or** `batchDelete` |
| `source.query` (query-shape) | `batchInsert` |

Omitted keys default to `false`. Advertise only what your adapter actually supports — the engine will reject users at `addPipeline(...)` rather than halfway through the first run.

## Factory resolution order

1. `config.target.adapter` — class reference extending `BaseTargetAdapter`. Full control; skips the service-based dispatch.
2. `config.target.service` unset or `'db'` → built-in `DbTargetAdapter`.
3. `config.target.kind` (`'odata' | 'odata-v2'`) — explicit transport selector. Wins over the connected service's auto-detected kind.
4. Auto-detected `service.options.kind` (`'odata' | 'odata-v2'`) on the connected remote service → built-in `ODataTargetAdapter`.
5. Any other `config.target.service` with no `target.adapter` → **registration error** pointing to this page. The factory does not silently fall back to the local DB.

## Worked example — a reporting-service target adapter

Forward mapped rows to a remote CAP service via `send({ event, data })`. Illustrates the full contract including capability-based rejection.

```javascript
const cds = require('@sap/cds');
const BaseTargetAdapter = require('cds-data-pipeline/srv/adapters/targets/BaseTargetAdapter');

class ReportingTargetAdapter extends BaseTargetAdapter {
    async _reporting() {
        if (!this._svc) {
            const targetService = this.config.target && this.config.target.service;
            this._svc = this.service || await cds.connect.to(targetService);
        }
        return this._svc;
    }

    async writeBatch(records, { mode }) {
        if (!records || records.length === 0) {
            return { created: 0, updated: 0, deleted: 0 };
        }
        const svc = await this._reporting();

        if (mode === 'snapshot') {
            throw new Error(
                `ReportingTargetAdapter: snapshot writes unsupported — ` +
                `capabilities().batchInsert must be false`
            );
        }

        await svc.send({ event: 'upsertBatch', data: { rows: records } });
        return { created: records.length, updated: 0, deleted: 0 };
    }

    async truncate() {
        const svc = await this._reporting();
        await svc.send({ event: 'truncate', data: {} });
    }

    async deleteSlice() {
        throw new Error(
            `ReportingTargetAdapter: deleteSlice unsupported — ` +
            `capabilities().batchDelete must be false`
        );
    }

    capabilities() {
        return {
            batchInsert: false,           // remote has no batch-insert endpoint
            keyAddressableUpsert: true,   // `upsertBatch` honours keys
            batchDelete: false,           // no slice support
            truncate: true,               // `truncate` exists
        };
    }
}

module.exports = ReportingTargetAdapter;
```

Wire it on registration:

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
    mode: 'delta',
});

// The following would be rejected at registration — source.query requires
// batchInsert, which ReportingTargetAdapter reports as false:
//
// await pipelines.addPipeline({
//     name: 'OrdersRollup',
//     source: { kind: 'cqn', service: 'OrdersService',
//               query: () => SELECT.from('Orders').columns(...).groupBy(...) },
//     target: { service: 'ReportingService', entity: '...', adapter: ReportingTargetAdapter },
// });
```

## Transactional semantics

The engine wraps the WRITE loop in a `cds.tx` transaction only for query-shape (snapshot) pipelines — so `truncate` / `deleteSlice` + batch `INSERT`s commit atomically and a mid-run crash leaves the previous snapshot intact. Entity-shape (UPSERT) pipelines run without an outer transaction: each batch commits on its own so partial progress survives interruptions.

Target adapters do not have to manage `cds.tx` themselves; they inherit the ambient `cds.context` / transaction from the engine. Custom remote-protocol adapters (like the reporting-service adapter above) need to surface their own atomicity guarantees at the service boundary — the engine's `cds.tx` does not span remote HTTP calls.

## See also

- [Targets → overview](index.md) — factory resolution and the capability-gating matrix.
- [Targets → Local DB](db.md) and [OData](odata.md) — the two built-in target adapters.
- [Sources → Custom source adapter](../sources/custom.md) — the peer contract for the READ phase.
- [Recipes → Custom target adapter](../recipes/custom-target-adapter.md) — scenario-driven walkthrough.
- [Recipes → Write-hook override](../recipes/write-hook-override.md) — the lightweight alternative for one-off forwarding.
- [Concepts → Inference rules](../concepts/inference.md) — target dispatch and the full capability-gated validation matrix.

# Custom target adapter

**When to pick this recipe:** the destination is not the local DB and not an OData service — reporting services, message buses, custom HTTP APIs, anything else. Writing a target adapter gives you a reusable class that plays by the engine's capability-gating rules, and it is the only route that stops the factory from rejecting non-`db`, non-OData targets at registration.

For the formal contract and factory-resolution order see [Targets → Custom target adapter](../targets/custom.md). This page is a scenario-driven walkthrough.

## Scenario — forward rows to a reporting service

Orders live in a CAP source service (`OrdersService`). A downstream CAP service (`ReportingService`) exposes an `upsertBatch` event to ingest pre-aggregated facts. You want a pipeline that reads orders entity-shape, maps them to fact rows, and forwards each batch to the reporting service. The same adapter should be reusable for a half-dozen similar feeds.

## Adapter

Extend `BaseTargetAdapter` and implement the three write primitives plus the `capabilities()` advertisement:

```javascript
// adapters/ReportingTargetAdapter.js
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

The four capability flags are not cosmetic. `_validateTargetCapabilities` consults them at registration — pipelines that need `batchInsert` (query-shape `source.query`) or `batchDelete` (`mode: 'full'` with partial delete) will be rejected for this adapter before the first run.

## Pipeline registration

```javascript
const cds = require('@sap/cds');
const ReportingTargetAdapter = require('./adapters/ReportingTargetAdapter');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

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
};
```

The factory resolves `ReportingTargetAdapter` via `target.adapter` (step 1 of the factory order). `target.service` is still honoured — `this.service` is injected as the connected `ReportingService` handle — but the factory no longer needs it to pick an adapter.

## Capability-based rejection

The engine rejects incompatible configs up front rather than halfway through a run:

```javascript
// Rejected at registration — source.query requires batchInsert,
// which ReportingTargetAdapter reports as false:
await pipelines.addPipeline({
    name: 'OrdersRollup',
    source: {
        kind: 'cqn',
        service: 'OrdersService',
        query: () => SELECT.from('Orders').columns(/* aggregates */).groupBy('status'),
    },
    target: {
        service: 'ReportingService',
        entity: 'ReportingService.OrderRollup',
        adapter: ReportingTargetAdapter,
    },
});
// → Error: target adapter lacks `batchInsert` — required by query-shape pipelines.
```

See [Concepts → Inference rules → Registration validation](../concepts/inference.md#registration-validation-matrix) for the full matrix.

## What happens at runtime

1. Schedule fires (or a manual `run` is dispatched via the management service).
2. `PIPELINE.READ` runs against `OrdersService.Orders` through the auto-selected source adapter, yielding batches.
3. `PIPELINE.MAP` applies any renames / filters.
4. For each batch the engine calls `ReportingTargetAdapter.writeBatch(records, { mode: 'upsert', target })` — which fans out to `ReportingService.send('upsertBatch', ...)`.
5. If `mode: 'full'` is used, `truncate` is called once before the first batch.
6. The tracker row is updated with the new `lastSync`.

## When to pick this over a write-hook override

- **Reuse:** the adapter is a class — drop it into multiple pipelines without repeating the forwarding logic.
- **Capability gating:** the `capabilities()` advertisement makes misuse a registration-time error rather than a run-time one.
- **Composability with `mode: 'full'` and partial refresh:** the adapter owns `truncate` / `deleteSlice`, so the engine's refresh semantics work correctly.

Pick a [write-hook override](write-hook-override.md) instead for one-off forwarding that will not be repeated, or when you want to layer a bespoke write on top of the default `DbTargetAdapter` (e.g. write to a staging table *and* forward).

## See also

- [Targets → Custom target adapter](../targets/custom.md) — the formal `BaseTargetAdapter` contract.
- [Targets → overview](../targets/index.md) — factory resolution and capability gating.
- [Concepts → Inference rules](../concepts/inference.md) — how `target.adapter` plugs into target dispatch.
- [Recipes → Custom source adapter](custom-source-adapter.md) — the peer recipe for the READ phase.
- [Recipes → Write-hook override](write-hook-override.md) — the lightweight alternative.

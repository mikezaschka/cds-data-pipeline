# Write-hook override

**When to pick this recipe:** the forwarding is one-off and not worth a reusable target-adapter class, or you want to layer a bespoke write on top of the default [`DbTargetAdapter`](../targets/db.md) (write to a staging table *and* fire off a side-effect). The pattern is simply to register an `on('PIPELINE.WRITE', name, handler)` that takes over the per-batch write.

This is the pre-target-adapter pattern — it still works and stays supported alongside custom target adapters. The two routes are compatible.

## Scenario — forward orders to a reporting service without an adapter class

Same destination as the [custom target adapter recipe](custom-target-adapter.md), but the forwarding logic lives inline with the pipeline registration. You still point the pipeline at a DB staging target so the default `DbTargetAdapter` drives `truncate` / `deleteSlice`, but the per-batch write is replaced by your handler.

```javascript
const cds = require('@sap/cds');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'OrdersToReportingInline',
        source: { service: 'OrdersService', entity: 'Orders' },
        target: { entity: 'db.OrderFactsStaging' },  // staging table, overwritten below
        mode: 'delta',
    });

    pipelines.on('PIPELINE.WRITE', 'OrdersToReportingInline', async (req) => {
        const reporting = await cds.connect.to('ReportingService');
        const rows = req.data.targetRecords;
        await reporting.send({ event: 'OrderFacts.upsertBatch', data: { rows } });
        req.data.statistics = { created: rows.length, updated: 0, deleted: 0 };
    });
};
```

Single-winner `on` semantics mean the hook **replaces** `DbTargetAdapter.writeBatch` for this pipeline — the staging table is never actually written to. If you want the default behaviour to still run, register a `before` or `after` hook instead and leave the `on` slot untouched.

## What happens at runtime

1. Schedule fires, the engine issues `PIPELINE.READ` and `PIPELINE.MAP` as usual.
2. For each batch, `PIPELINE.WRITE` fires. The single-winner `on` handler runs instead of the default target adapter's `writeBatch`.
3. The handler must set `req.data.statistics = { created, updated, deleted }` — the tracker reads those counts for per-run history.
4. If `mode: 'full'`, the engine still calls `DbTargetAdapter.truncate(target)` against the staging table before the first batch. If you don't want that, point the target at a throwaway table or use a custom target adapter instead.

## When to prefer a custom target adapter

Pick [custom target adapter](custom-target-adapter.md) over a write-hook override when:

- **The forwarding will be reused.** An adapter is a class; a hook is inline code bound to one pipeline name.
- **You need capability gating.** A custom adapter can declare `batchInsert: false` and have the engine reject `source.query` at registration; a hook can only blow up at runtime.
- **You need `truncate` / `deleteSlice` to go somewhere sensible.** A hook leaves those on the default DB adapter pointing at whatever `target.entity` is. An adapter owns the clear path too.

Pick this recipe over a custom adapter when:

- **The forwarding is one-off** — a prototype, a debug dump, a migration.
- **You want to compose with the default `DbTargetAdapter`** — e.g. write to a staging table *and* publish an event (`before` hook to enrich, `after` hook to publish, default `on` untouched).

## Other phases

The same pattern works for `PIPELINE.READ` and `PIPELINE.MAP` — the engine's single-winner `on` replaces the default behaviour, `before` / `after` layer on top. See [Reference → Management Service → Event hooks](../reference/management-service.md#event-hooks) for the full hook surface and signatures.

## See also

- [Recipes → Custom target adapter](custom-target-adapter.md) — the reusable, capability-gated alternative.
- [Reference → Management Service](../reference/management-service.md) — programmatic `addPipeline` API and the full event-hook reference.
- [Concepts → Terminology → Event namespace](../concepts/terminology.md#event-namespace) — `PIPELINE.*` hook semantics.

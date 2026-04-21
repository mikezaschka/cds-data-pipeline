# Local DB (`DbTargetAdapter`)

`DbTargetAdapter` is the default target adapter. It is resolved automatically when `target.service` is unset or set to `'db'` — the factory short-circuits service-based dispatch for the local-DB case because it is by far the most common target. No `target.adapter` or `target.kind` is required.

Writes go through CAP's `cds.connect.to('db')`:

- `writeBatch(records, { mode })` — `UPSERT.into(entity).entries(records)` for `mode: 'upsert'` (entity-shape), or `INSERT.into(entity).entries(records)` for `mode: 'snapshot'` (query-shape).
- `truncate(target)` — `DELETE.from(entity)`. Multi-source-aware — a pipeline that shares a target with others only truncates rows it itself produced.
- `deleteSlice(target, predicate)` — `DELETE.from(entity).where(predicate)` for partial-refresh pipelines.

## Registration

Any pipeline registering a DB target needs nothing adapter-specific:

```javascript
await pipelines.addPipeline({
    name: 'BusinessPartners',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.BusinessPartners' },
    delta: { field: 'modifiedAt', mode: 'timestamp' },
    schedule: 600000,
});
```

The factory resolves `DbTargetAdapter` because `target.service` is unset. Setting `target.service: 'db'` explicitly resolves the same adapter.

## Capabilities

```javascript
{
    batchInsert:          true,   // INSERT many rows in one call (snapshot writes)
    keyAddressableUpsert: true,   // UPSERT by key (delta writes)
    batchDelete:          true,   // DELETE WHERE <predicate>
    truncate:             true,   // DELETE all rows from the target
}
```

All four capabilities are advertised, so every combination of `mode` (`delta`, `full`, `partial-refresh`) and read shape (entity-shape, query-shape) registers cleanly. The [Inference rules registration matrix](../concepts/inference.md#registration-validation-matrix) only rejects configs for adapters missing a required capability — never for `DbTargetAdapter`.

## Transactional semantics

Entity-shape (UPSERT, `mode: 'delta'` or `'full'`) writes are **not** wrapped in an outer transaction by the engine. Each batch commits on its own so partial progress survives interruptions.

Query-shape (snapshot) writes **are** wrapped in an outer `cds.tx` that spans `truncate` + all `INSERT` batches. A mid-run crash rolls back and leaves the previous snapshot intact.

See [Targets → overview → Transactional semantics](index.md#transactional-semantics) for the engine-level behaviour both adapters inherit.

## Target shape

The target entity is typically a local table annotated with `@cds.persistence.table`. For replicate pipelines the [consumption-view pattern](../concepts/consumption-views.md) gives you the target schema, column restriction, and rename mapping in one CDS declaration:

```cds
using { S4 } from '../srv/external/API_BUSINESS_PARTNER';

@cds.persistence.table
entity Customers as projection on S4.A_BusinessPartner {
    BusinessPartner as ID,
    PersonFullName  as Name,
    LastChangeDate  as modifiedAt,
} where BusinessPartnerCategory = '1';
```

For materialize pipelines the target is a plain `@cds.persistence.table` whose columns match the `source.query` result shape.

## See also

- [Targets → overview](index.md) — factory resolution and the capability-gating matrix.
- [Targets → OData](odata.md) — the built-in non-DB alternative.
- [Concepts → Consumption views](../concepts/consumption-views.md) — the idiomatic replicate-target pattern.
- [Recipes → Built-in replicate](../recipes/built-in-replicate.md) — worked example with a DB target.
- [Recipes → Built-in materialize](../recipes/built-in-materialize.md) — query-shape snapshot to a DB target.

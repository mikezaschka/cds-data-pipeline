---
hide:
  - navigation
---

# cds-data-pipeline

!!! warning "Work in progress"
    This plugin is under active development. APIs, schema, and documentation are still evolving and may change before a stable release.

**A CAP application-layer plugin for declarative, traceable, scheduled data pipelines between CAP services.** Each pipeline is a linear `READ → MAP → WRITE` job between exactly one source and one target, with built-in tracker, retry, concurrency guard, a management OData API, and event hooks.

Register a pipeline programmatically and let the engine run it on a schedule:

```javascript
const cds = require('@sap/cds');

const pipelines = await cds.connect.to('DataPipelineService');

await pipelines.addPipeline({
    name: 'BusinessPartners',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.BusinessPartners' },
    delta: { field: 'modifiedAt', mode: 'timestamp' },
    schedule: 600000, // every 10 minutes
});
```

Every run is tracked in the `Pipelines` and `PipelineRuns` tables, exposed via the OData management service at `/pipeline`.

!!! tip "Model replicate targets as consumption views"
    For `replicate` pipelines mirroring a remote entity, the idiomatic CAP pattern is to declare the target as a **consumption view** — a `projection on <remote.Entity>` annotated with `@cds.persistence.table`. One CDS declaration defines target schema, column restriction, rename mapping, and filter. See [Concepts → Consumption views](concepts/consumption-views.md) and the capire [CAP-level Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation).

## Scope

`cds-data-pipeline` is **application-layer only**. It moves data between CAP-addressable services from inside one CAP app, using CAP's own `cds.connect.to`, destinations, and credentials. It fills the gap between ad-hoc `cds.spawn` replication (which lacks production characteristics) and platform-layer data-movement products — for cases where movement is internal to a CAP application and does not justify a separate integration product.

It is **not** a replacement for SAP's enterprise integration or data-movement tooling:

- **SAP Integration Suite (Cloud Integration)** — cross-system, cross-protocol integration with a visual modeler and operational monitoring.
- **SAP Datasphere replication flows** — operationally-managed replication into the data fabric.
- **SAP HANA Smart Data Integration (SDI)** — cross-system replication and federation below the app layer.
- **SAP Landscape Transformation (SLT)** — trigger-based replication from SAP sources.
- **SAP Data Intelligence** — data pipelines with a visual modeler, scheduler, and operational monitoring at the platform layer.

Those products solve cross-system, cross-protocol, operationally-managed movement. This plugin does not — and is not trying to.

<div class="grid cards" markdown>

-   :material-rocket-launch: **Features**

    ---

    What the engine does today, grouped by capability — source adapters, management service, observability, scheduling, resilience.

    [:octicons-arrow-right-24: Features](reference/features.md)

-   :material-wrench: **Management Service**

    ---

    Inspect and control pipelines at runtime. `Pipelines` and `PipelineRuns` entities, `run` / `flush` / `status` actions, and the programmatic `DataPipelineService` API with event hooks.

    [:octicons-arrow-right-24: Management Service](reference/management-service.md)

-   :material-swap-horizontal: **Sources**

    ---

    Protocol-specific READ phase: OData V2 / V4 (CAP-native), REST (offset / cursor / page pagination, delta URL parameter, nested-response extraction), CQN (in-process CAP services, `cds.requires` DB bindings), plus a pluggable `BaseSourceAdapter` for everything else.

    [:octicons-arrow-right-24: Sources overview](sources/index.md) · [:octicons-arrow-right-24: OData](sources/odata.md) · [:octicons-arrow-right-24: REST](sources/rest.md) · [:octicons-arrow-right-24: CQN](sources/cqn.md)

-   :material-database-arrow-right: **Targets**

    ---

    Protocol-specific WRITE phase: `DbTargetAdapter` (local DB, default), `ODataTargetAdapter` (remote OData V2 / V4 via CAP's connected service), plus a pluggable `BaseTargetAdapter` for non-db / non-OData destinations. Capability-gated at registration.

    [:octicons-arrow-right-24: Targets overview](targets/index.md) · [:octicons-arrow-right-24: Local DB](targets/db.md) · [:octicons-arrow-right-24: OData](targets/odata.md) · [:octicons-arrow-right-24: Custom target adapter](targets/custom.md)

-   :material-chart-line: **Pipeline recipes**

    ---

    Four plugin entry points: built-in adapters (no code), custom source adapter, custom target adapter, `PIPELINE.WRITE` hook override. Each recipe is a scenario-driven walkthrough.

    [:octicons-arrow-right-24: Recipes overview](recipes/index.md) · [:octicons-arrow-right-24: Built-in replicate](recipes/built-in-replicate.md) · [:octicons-arrow-right-24: Built-in materialize](recipes/built-in-materialize.md)

</div>

## Installation

```bash
npm add cds-data-pipeline
```

Peer dependency: `@sap/cds` >= 8. The plugin auto-activates on load via `cds-plugin.js`.

!!! note "SAP data extraction"
    `@sap/cds` ships under the [SAP Developer License Agreement (3.2 CAP)](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP.txt). §1 requires that Customer Applications will not "permit mass data extraction from an SAP product to a non-SAP product, including use, modification, saving or other processing of such data in the non-SAP product, except and only to the extent that the extraction is solely used for and required for interoperability with an SAP product." When you point a pipeline at an SAP source, keep it inside that interoperability carve-out.

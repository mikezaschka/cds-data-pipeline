# Get started

This walkthrough sets up **one replicate pipeline** using the public **[Northwind OData V4](https://services.odata.org/V4/Northwind/Northwind.svc/)** sample API: remote **Products** → local database table. The service is anonymous and read-only and as such fine for learning; swap the URL and model for your own API in production and continue to grow from here.

## Prerequisites

- **Node.js** >= 22 (see the [package `engines`](https://github.com/mikezaschka/cds-data-pipeline/blob/main/package.json) field on the plugin repo).
- **`@sap/cds`** >= 9.2 (peer dependency of `cds-data-pipeline`).
- Network access to `https://services.odata.org` (or download `$metadata` once and import offline).

## 1. Install the plugin

```bash
npm add cds-data-pipeline
```

The plugin **registers `DataPipelineService` for you**. Its own `package.json` declares `cds.requires.DataPipelineService.impl`, and CAP merges that into your app’s effective config when the package is installed—so you normally **do not** copy that block into your project.

Include the **tracker** schema so `Pipelines` / `PipelineRuns` tables exist. In your DB model (for example `db/schema.cds`):

```cds
using from 'cds-data-pipeline/db';

namespace my.app;

// … your entities and consumption views …
```

Expose the **management OData** surface by reusing the plugin’s service definition in a service file (for example `srv/pipeline-mgmt.cds`):

```cds
using from 'cds-data-pipeline/srv/DataPipelineManagementService';
```

You can `extend` or annotate that service in your app for authorization. The plugin does not ship auth annotations; see [Management Service](reference/management-service.md#securing-pipeline-in-your-app).

## 2. Import the Northwind OData API

Use the same flow as capire [**Consuming external services → OData APIs**](https://cap.cloud.sap/docs/guides/integration/calesi#odata-apis): start from an **OData EDMX** (metadata) file on disk, then run **`cds import`**. That command copies the file into **`srv/external/`**, generates a **`.csn`** beside it, and **merges the required `cds.requires` entry into your app’s `package.json`**. For **`cds-data-pipeline` there is nothing to add beyond that**—the plugin only needs the connected service name (e.g. `northwind`) that `cds import` registers.

1. **Download metadata** (example: Northwind V4 — save as `.edmx`):

```bash
curl -sL 'https://services.odata.org/V4/Northwind/Northwind.svc/$metadata' -o northwind.edmx
```

2. **Import** from your CAP project root (adjust the path if the file lives elsewhere):

```bash
cds import northwind.edmx
```

3. **Connectivity** — ensure the generated **`cds.requires.<service>`** block can reach the real API: set **`credentials.url`** to the **service root** (no `$metadata` suffix), e.g. `https://services.odata.org/V4/Northwind/Northwind.svc`, or use a **destination** on SAP BTP. If you already use packaged APIs or `npm add` for models, follow the same guide; the pipeline only references the **`requires` key** and **`source.entity`** names from the imported model.

After import, CAP prints a **`using`** hint such as:

```cds
using { northwind as external } from './external/northwind';
```

(paths are relative to **`srv/`** in service code—adjust for your layout). The service name in CSN (here **`northwind`**) is what you pass as `source.service` in `addPipeline` below.

## 3. Define a consumption view

Model the **local target** as a projection on **`northwind.Products`** and persist it as a table. The example restricts columns, **renames** one field (`ProductName` → `ProductTitle` via `as`), and excludes discontinued rows (the static `where` is merged into pipeline READs for OData / CQN sources):

```cds
using { northwind } from '../srv/external/northwind';

@cds.persistence.table
entity LocalProducts as projection on northwind.Products {
    ProductID,
    ProductName as ProductTitle,
    UnitPrice,
    UnitsInStock,
} where Discontinued = false;
```

Place this in your app namespace (for example `my.app` in `db/schema.cds`) so the fully qualified name is `my.app.LocalProducts`. Why this pattern matters is explained in [Concepts → Consumption views](concepts/consumption-views.md).

## 4. Register your first pipeline

In `server.js` (or the file your `package.json` `"cds"` server entry loads), connect after CAP has served services and call `addPipeline`.

With a **consumption view** as the target the engine infers projected columns and **`remoteToLocal` renames** (here `ProductName` → `ProductTitle`) from the projection. Northwind **Products** has **no** `ModifiedAt`-style field, so use **`mode: 'full'`** for this API (your own APIs with a change timestamp can use **`mode: 'delta'`** and `delta.field` set to the **remote** field name—see [Built-in replicate](recipes/built-in-replicate.md)).

```javascript
const cds = require('@sap/cds');

cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'NorthwindProducts',
        source: { service: 'northwind', entity: 'Products' },
        target: { entity: 'my.app.LocalProducts' },
        mode: 'full',
        schedule: 600_000, // optional: every 10 minutes; omit and use execute (below)
    });

    // Example: tweak one column after the default mapper (do not use `on` here — it would replace the default)
    pipelines.after('PIPELINE.MAP_BATCH', 'NorthwindProducts', (_results, req) => {
        for (const row of req.data.targetRecords) {
            if (row.ProductTitle != null) {
                row.ProductTitle = String(row.ProductTitle).trim().toUpperCase();
            }
        }
    });
});

module.exports = cds.server;
```

**`after('PIPELINE.MAP_BATCH', …)`** runs per batch **on top of** the built-in mapping: **`req.data.targetRecords`** already has **local** element names (after projection renames — here **`ProductTitle`**, not `ProductName`), so you can normalize or enrich a single field before **`WRITE_BATCH`**. A user **`on`** for `PIPELINE.MAP_BATCH` would **replace** the default mapper entirely — use **`before`** / **`after`** when you only want to layer on behavior. See [Event hooks](recipes/event-hooks.md).

You can still pass an explicit `viewMapping` if you want the mapping in JavaScript or need to override inference.

Expose `LocalProducts` on an application service if you want to query it over OData. Tuning and variants are in [Built-in replicate](recipes/built-in-replicate.md).

## 5. Deploy and run

- **SQLite / local:** `cds deploy` (or your usual profile), then `cds watch` / `cds serve`.
- **HANA:** include the plugin DB model in production build and deploy with your HDI flow.

## 6. Open the monitor

**Scaffold** (requires `@sap/cds-dk` so the `cds add` CLI is available): from your project root, with `cds-data-pipeline` already a dependency, run:

```bash
cds add data-pipeline-monitor
```

That copies the pre-built **Pipeline Console** (freestyle FCL UI) into `app/pipeline-console`, adds a `pipeline-console` devDependency and [cds-plugin-ui5](https://github.com/ui5-community/ui5-ecosystem-showcase/tree/main/packages/cds-plugin-ui5) configuration (default mount: `/pipeline-console`). A future version may ship the Fiori **Pipeline Monitor** list report under the same command; today the console is the scaffolded UI.

Then run `npm install` and `cds watch`, and open `/pipeline-console/index.html` (or your launchpad) on the same origin as the CAP server.

**Without the scaffold, you can:**

- Use the **management OData API** directly, for example `GET /pipeline/Pipelines` and `GET /pipeline/PipelineRuns`. See [Management Service](reference/management-service.md).
- Reuse the **reference UI** in this repository: build the shared UI5 apps under `examples/_ui-pipeline` and mount them with cds-plugin-ui5, as in [examples/01-replicate-odata](https://github.com/mikezaschka/cds-data-pipeline/tree/main/examples/01-replicate-odata) (`pipeline-monitor` at `/pipeline-monitor`, `pipeline-console` at `/pipeline-console`).

## 7. Query the service and check the data

1. **Trigger a run** if you did not set `schedule`: `POST /pipeline/execute` with body `{ "name": "NorthwindProducts", "mode": "full" }` (and auth if you secured `/pipeline`). See [`execute`](reference/management-service.md#execute).
2. **Tracker:** `GET /pipeline/Pipelines('NorthwindProducts')` or `GET /pipeline/status(name='NorthwindProducts')`.
3. **Business data:** query your app’s OData entity that projects `my.app.LocalProducts` (or `SELECT` from the entity in CAP) and confirm rows match non-discontinued Northwind products.

## Next steps — recipes

- [Built-in replicate](recipes/built-in-replicate.md)
- [Built-in materialize](recipes/built-in-materialize.md)
- [Multi-source fan-in](recipes/multi-source.md)
- [Custom source adapter](recipes/custom-source-adapter.md)
- [Custom target adapter](recipes/custom-target-adapter.md)
- [Event hooks](recipes/event-hooks.md)
- [External scheduling (JSS)](recipes/external-scheduling-jss.md)
- [Internal scheduling (queued)](recipes/internal-scheduling-queued.md)

Full overview and decision tree: [Recipes](recipes/index.md).

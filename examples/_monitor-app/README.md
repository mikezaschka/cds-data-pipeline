# Shared Pipeline Monitor FE app

A single Fiori Elements List Report + Object Page over the plugin's management service (`/pipeline/Pipelines`). Every numbered example copies these files into its own `app/` folder so `/launchpage.html` and `/pipeline-monitor/webapp/` resolve from the example's CAP server.

| File | Purpose |
|---|---|
| `_generate.js` | Regenerates `pipeline-monitor/webapp/*` and `launchpage.html`. Run after any tweak. |
| `pipeline-monitor/webapp/` | Generated FE app files — `manifest.json`, `Component.js`, `index.html`, `i18n/`. |
| `launchpage.html` | Sandbox launchpad with a single tile linking to the FE app. |

**UI annotations** for the List Report / Object Page live in the plugin at [`srv/monitor-annotations.cds`](../../srv/monitor-annotations.cds) (not under this folder) so CDS resolves `DataPipelineManagementService` from `node_modules/cds-data-pipeline`. Each example adds:

```cds
using from 'cds-data-pipeline/srv/monitor-annotations';
```

## Column set

The tracker no longer has a `kind` column (pipeline behaviour is shape-inferred — [docs/concepts/inference.md](../../docs/concepts/inference.md)), so the line item shows:

`name, status, mode, origin, lastSync, errorCount, statistics_created, statistics_updated, statistics_deleted`

`origin` shows the `source.origin` stamp from multi-source fan-in. Empty for single-origin pipelines.

## Regenerating

```bash
node examples/_monitor-app/_generate.js
```

Changes to the generator should be followed by copying the new files into each example's `app/` folder — the easiest way is to re-run each example's `start.sh`, which runs a quick `cp -R` before starting the server.

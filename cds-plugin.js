const cds = require('@sap/cds')
const DataPipelineService = require('./srv/DataPipelineService')

const LOG = cds.log('cds-data-pipeline')

/**
 * Plugin entry point for the `cds-data-pipeline` engine.
 *
 * Responsibilities:
 *  - Instantiate `DataPipelineService` and register it under its CAP service
 *    name so `cds.connect.to('DataPipelineService')` resolves for consumers
 *    and peer plugins.
 *
 * The tracker entities (`plugin.data_pipeline.Pipelines` /
 * `plugin.data_pipeline.PipelineRuns`) are materialized by `cds deploy`
 * (SQLite) or by the HDI deployer (HANA) from `db/index.cds`. The plugin
 * performs no runtime DDL — that is incompatible with HANA HDI.
 *
 * Why `cds.on('loaded')` and not `cds.once('served')`:
 *   Peer plugins that depend on this service may call
 *   `cds.connect.to('DataPipelineService')` from their own `served` handler.
 *   Plugin discovery order across sibling `node_modules/` entries is not
 *   guaranteed, so we register the service during `loaded` — which fires
 *   before `served` — to ensure it is resolvable regardless of which
 *   plugin's `served` handler runs first.
 */
let _registered = false
async function _ensurePipelineService() {
    if (_registered) return
    if (cds.services['DataPipelineService']) { _registered = true; return }
    const pipelineService = new DataPipelineService('DataPipelineService')
    await pipelineService.init()
    cds.services[pipelineService.name] = pipelineService
    _registered = true
    LOG._info && LOG.info('cds-data-pipeline ready')
}

cds.on('loaded', () => { _ensurePipelineService().catch(err => LOG.error(err)) })
cds.once('served', () => { _ensurePipelineService().catch(err => LOG.error(err)) })

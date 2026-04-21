const cds = require('@sap/cds')

const LOG = cds.log('cds-data-pipeline')

// Whitelist of trigger values accepted on the wire. Aligned with the
// `RunTrigger` enum in db/index.cds. Any other value (including `undefined`)
// falls back to `'manual'` so the OData surface cannot be used to write
// arbitrary strings into `PipelineRuns.trigger`.
const ALLOWED_TRIGGERS = new Set(['manual', 'scheduled', 'external', 'event'])

class DataPipelineManagementService extends cds.ApplicationService {
    async init() {
        this.on('run', async (req) => {
            const { name, mode } = req.data
            const trigger = ALLOWED_TRIGGERS.has(req.data.trigger) ? req.data.trigger : 'manual'
            const runMode = mode || 'delta'
            const srv = await cds.connect.to('DataPipelineService')

            // Async fire-and-forget path: dispatch the run in a detached
            // spawn and return immediately so external schedulers (JSS,
            // K8s CronJob, ...) don't hit their HTTP response window on
            // long pipelines. Outcome still lands in `PipelineRuns`.
            if (req.data.async === true) {
                cds.spawn(async () => {
                    try {
                        await srv.run(name, runMode, trigger)
                    } catch (err) {
                        LOG._error && LOG.error(`Async pipeline '${name}' failed:`, err)
                    }
                })
                return `Pipeline '${name}' accepted for async execution`
            }

            try {
                await srv.run(name, runMode, trigger)
                return `Pipeline '${name}' completed successfully`
            } catch (err) {
                req.error(500, `Pipeline '${name}' failed: ${err.message}`)
            }
        })

        this.on('flush', async (req) => {
            const { name } = req.data
            try {
                const srv = await cds.connect.to('DataPipelineService')
                await srv.clear(name)
                return `Pipeline '${name}' flushed successfully`
            } catch (err) {
                req.error(500, `Flush '${name}' failed: ${err.message}`)
            }
        })

        this.on('status', async (req) => {
            const { name } = req.data
            try {
                const srv = await cds.connect.to('DataPipelineService')
                return await srv.getStatus(name)
            } catch (err) {
                req.error(500, `Status check failed: ${err.message}`)
            }
        })

        await super.init()
    }
}

module.exports = DataPipelineManagementService

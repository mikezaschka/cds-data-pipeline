const cds = require('@sap/cds')

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
            const isAsync = req.data.async === true
            const srv = await cds.connect.to('DataPipelineService')

            try {
                const result = await srv.execute(name, { mode: runMode, trigger, async: isAsync })
                if (isAsync) {
                    return `Pipeline '${name}' accepted for async execution (runId=${result.runId})`
                }
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

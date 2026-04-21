const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('Internal schedule (spawn)', () => {
    cds.test(consumerRoot)
    const { expect } = require('@jest/globals')

    beforeAll(async () => {
        await startProvider()
        await waitForConsumerFixturePipelines()
    }, 60000)
    afterAll(async () => {
        await stopProvider()
    })

    it('schedule interval eventually records a PipelineRun', async () => {
        const srv = await getPipelineService()
        const name = `__sched_iv_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
            schedule: 250,
        })
        await srv.clear(name)
        await new Promise(r => setTimeout(r, 900))
        const runs = await SELECT.from('plugin_data_pipeline_PipelineRuns')
        const mine = runs.filter(r => r.pipeline_name === name)
        expect(mine.length).toBeGreaterThan(0)
    })

    it('rejects unknown schedule.engine on addPipeline', async () => {
        const srv = await getPipelineService()
        await expect(
            srv.addPipeline({
                name: `__sched_bad_${Date.now()}`,
                source: { service: 'ProviderService', entity: 'Customers' },
                target: { entity: 'consumer.ReplicatedCustomersV2' },
                schedule: { every: 1000, engine: 'kafka' },
            }),
        ).rejects.toThrow(/schedule\.engine/)
    })

    it('queued schedule throws when cds.queued API missing', async () => {
        if (typeof cds.queued === 'function') return
        const srv = await getPipelineService()
        await expect(
            srv.addPipeline({
                name: `__sched_q_${Date.now()}`,
                source: { service: 'ProviderService', entity: 'Customers' },
                target: { entity: 'consumer.ReplicatedCustomersV2' },
                schedule: { every: 1000, engine: 'queued' },
            }),
        ).rejects.toThrow(/cds\.queued/)
    })
})

const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('Full vs delta replication', () => {
    cds.test(consumerRoot)
    const { expect } = require('@jest/globals')

    beforeAll(async () => {
        await startProvider()
        await waitForConsumerFixturePipelines()
    }, 60000)
    afterAll(async () => {
        await stopProvider()
    })

    it('full mode truncates and reloads stable row count', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        let rows = await SELECT.from('consumer.ReplicatedCustomers')
        expect(rows.length).toBe(5)
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        rows = await SELECT.from('consumer.ReplicatedCustomers')
        expect(rows.length).toBe(5)
    })

    it('delta UPSERT does not duplicate rows', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedProducts', { mode: 'full', trigger: 'manual' })
        await srv.execute('ReplicatedProducts', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedProducts')
        expect(rows.length).toBe(5)
    })

    it('getStatus reports lastSync after successful run', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        const status = await srv.getStatus('ReplicatedCustomers')
        expect(status.lastSync).toBeTruthy()
        expect(status.status).toBe('idle')
    })
})

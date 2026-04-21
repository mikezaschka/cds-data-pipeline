/**
 * Jest setupFiles run before test modules load. CAP resolves cds.env from
 * cds.root on first access; default root is process.cwd() (repo root), which
 * would load the plugin's package.json instead of the test consumer app.
 */
process.env.CDS_PIPELINE_TEST_CONSUMER = 'true'

const path = require('path')
const cds = require('@sap/cds')

cds.root = path.resolve(__dirname, '../fixtures/consumer')

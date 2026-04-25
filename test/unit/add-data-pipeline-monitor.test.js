/**
 * @jest-environment node
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const cds = require('@sap/cds')
const cdsDk = require('@sap/cds-dk')

/**
 * @returns {import('../../lib/add-data-pipeline-monitor')}
 */
function loadAddPlugin() {
    // Load after Jest sets cwd / roots; path is from repo
    // eslint-disable-next-line import/no-dynamic-require -- test-only
    return require(path.join(__dirname, '../../lib/add-data-pipeline-monitor.js'))
}

describe('add-data-pipeline-monitor', () => {
    let oldCdsRoot, oldDkRoot, tmp

    beforeAll(() => {
        oldCdsRoot = cds.root
        oldDkRoot = cdsDk.root
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-add-'))
        fs.writeFileSync(
            path.join(tmp, 'package.json'),
            JSON.stringify({ name: 'tmp-cdp-app', private: true }, null, 2) + '\n',
        )
        cds.root = tmp
        cdsDk.root = tmp
    })

    afterAll(() => {
        cds.root = oldCdsRoot
        cdsDk.root = oldDkRoot
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('scaffolds pipeline console under app/pipeline-console and merges package.json', async () => {
        const AddDataPipelineMonitor = loadAddPlugin()
        const p = new AddDataPipelineMonitor()
        await p.run()

        const indexHtml = path.join(tmp, 'app', 'pipeline-console', 'webapp', 'index.html')
        expect(fs.existsSync(indexHtml)).toBe(true)

        const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'))
        expect(pkg.devDependencies['pipeline-console']).toBe('file:./app/pipeline-console')
        expect(pkg.devDependencies['cds-plugin-ui5']).toBe('^0.9')
        expect(pkg.cds['cds-plugin-ui5'].modules['pipeline-console'].mountPath).toBe('/pipeline-console')
    })
})

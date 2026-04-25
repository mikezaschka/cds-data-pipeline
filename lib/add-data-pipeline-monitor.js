/**
 * `cds add data-pipeline-monitor` — scaffolds the Pipeline Console (FCL) UI for
 * now; a future version may ship the Fiori list-report monitor under the same command.
 *
 * Use `Plugin` from `cds-dk` init (not `require('@sap/cds-dk')`), because `cds.add` is
 * only defined when the CLI runs `cds add` / `init` / `help` (see @sap/cds-dk `lib/index.js`).
 */
const cds = require('@sap/cds')
const { Plugin } = require('@sap/cds-dk/lib/init/add')
const { copy, path, write } = cds.utils
const { join } = path
const fs = cds.utils.fs

const CDP_PLUGIN_UI5 = '^0.9'

module.exports = class extends Plugin {
    static help() {
        return 'Pipeline UI (FCL console) + cds-plugin-ui5 wiring for the /pipeline OData API [console for now].'
    }

    async run() {
        const src = join(__dirname, '..', 'app', 'pipeline-console')
        if (!fs.existsSync(src)) {
            throw new Error(
                '[cds-data-pipeline] Pre-built UI missing at app/pipeline-console — install from the published npm package',
            )
        }

        await copy(src).to('app', 'pipeline-console', 'webapp')

        await write(
            JSON.stringify(
                {
                    name: 'pipeline-console',
                    version: '0.1.0',
                    private: true,
                },
                null,
                2,
            ) + '\n',
        ).to('app/pipeline-console/package.json')

        await write(
            [
                'Pipeline Console (FCL) scaffolded by `cds add data-pipeline-monitor`.',
                'The management OData API is served at /pipeline/; this app is mounted (via cds-plugin-ui5) at /pipeline-console by default.',
                'Run `npm install` in the project root, then `cds watch` and open the launch URL or /pipeline-console/index.html .',
            ].join('\n\n') + '\n',
        ).to('app/pipeline-console/README.md')

        const pkgPath = join(cds.root, 'package.json')
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        pkg.devDependencies = pkg.devDependencies || {}
        if (!pkg.devDependencies['cds-plugin-ui5']) {
            pkg.devDependencies['cds-plugin-ui5'] = CDP_PLUGIN_UI5
        }
        pkg.devDependencies['pipeline-console'] = 'file:./app/pipeline-console'

        pkg.cds = pkg.cds || {}
        const ui5 = (pkg.cds['cds-plugin-ui5'] = pkg.cds['cds-plugin-ui5'] || {})
        const modules = (ui5.modules = ui5.modules || {})
        if (!modules['pipeline-console']) {
            modules['pipeline-console'] = { mountPath: '/pipeline-console' }
        }

        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    }
}

#!/usr/bin/env node
/**
 * Generator for the shared Pipeline Monitor Fiori Elements app.
 *
 * Run with:
 *   node examples/_monitor-app/_generate.js
 *
 * Emits a minimal List Report over `DataPipelineManagementService.Pipelines`
 * (exposed at `/pipeline/Pipelines` by cds-data-pipeline) plus a sandbox
 * launchpad with a single tile. Each numbered example copies or symlinks
 * the produced `webapp/` + `launchpage.html` into its own `app/` folder.
 *
 * UI annotations: `srv/monitor-annotations.cds` in the plugin (not here).
 */
const fs = require('fs')
const path = require('path')

const APP_ID = 'pipeline.monitor'
const APP_TITLE = 'Pipeline Monitor'
const ENTITY = 'Pipelines'
const DATA_SOURCE_URI = '/pipeline/'

function manifest() {
    return {
        _version: '1.59.0',
        'sap.app': {
            id: APP_ID,
            type: 'application',
            title: '{{appTitle}}',
            description: '{{appTitle}}',
            applicationVersion: { version: '1.0.0' },
            dataSources: {
                mainService: {
                    uri: DATA_SOURCE_URI,
                    type: 'OData',
                    settings: { odataVersion: '4.0' }
                }
            }
        },
        'sap.ui': {
            technology: 'UI5',
            deviceTypes: { desktop: true, tablet: true, phone: true }
        },
        'sap.ui5': {
            dependencies: {
                minUI5Version: '1.120.0',
                libs: {
                    'sap.m': {},
                    'sap.ui.core': {},
                    'sap.fe.templates': {}
                }
            },
            models: {
                i18n: {
                    type: 'sap.ui.model.resource.ResourceModel',
                    settings: { bundleName: `${APP_ID}.i18n.i18n` }
                },
                '': {
                    dataSource: 'mainService',
                    settings: {
                        synchronizationMode: 'None',
                        operationMode: 'Server',
                        autoExpandSelect: true,
                        earlyRequests: true
                    },
                    type: 'sap.ui.model.odata.v4.ODataModel'
                }
            },
            routing: {
                routes: [
                    { pattern: ':?query:', name: 'List', target: 'List' },
                    { pattern: `${ENTITY}({key}):?query:`, name: 'Detail', target: 'Detail' }
                ],
                targets: {
                    List: {
                        type: 'Component',
                        id: 'List',
                        name: 'sap.fe.templates.ListReport',
                        options: {
                            settings: {
                                contextPath: `/${ENTITY}`,
                                variantManagement: 'Page',
                                initialLoad: true,
                                navigation: {
                                    [ENTITY]: { detail: { route: 'Detail' } }
                                }
                            }
                        }
                    },
                    Detail: {
                        type: 'Component',
                        id: 'Detail',
                        name: 'sap.fe.templates.ObjectPage',
                        options: { settings: { contextPath: `/${ENTITY}` } }
                    }
                }
            },
            contentDensities: { compact: true, cozy: true },
            // Auto-refresh OData (list + object page). Set refreshIntervalSeconds to 0 to disable.
            pipelineMonitor: {
                refreshIntervalSeconds: 30
            }
        }
    }
}

const COMPONENT_JS = `sap.ui.define([
    "sap/fe/core/AppComponent"
], function (AppComponent) {
    "use strict";

    var MANIFEST_REFRESH = "/sap.ui5/pipelineMonitor/refreshIntervalSeconds";

    function refreshPipelineMonitorModel(oModel) {
        if (!oModel || typeof oModel.getGroupId !== "function" || typeof oModel.getAllBindings !== "function") {
            return;
        }
        var sGroup = oModel.getGroupId();
        if (typeof oModel.refresh === "function") {
            oModel.refresh(sGroup);
        }
        oModel.getAllBindings().forEach(function (oBinding) {
            if (!oBinding || typeof oBinding.refresh !== "function") {
                return;
            }
            if (oBinding.isRoot && oBinding.isRoot()) {
                return;
            }
            if (oBinding.isResolved && !oBinding.isResolved()) {
                return;
            }
            var bSuspended = oBinding.isSuspended && oBinding.isSuspended();
            try {
                oBinding.refresh(bSuspended ? undefined : sGroup);
            } catch (e) {
                /* property bindings etc. may not support refresh */
            }
        });
    }

    return AppComponent.extend("${APP_ID}.Component", {
        metadata: { manifest: "json" },

        init: function () {
            AppComponent.prototype.init.apply(this, arguments);
            var iSec = this.getManifestEntry(MANIFEST_REFRESH);
            if (iSec === undefined) {
                iSec = 30;
            }
            if (iSec <= 0) {
                return;
            }
            var iMs = iSec * 1000;
            var that = this;
            this._oPipelineRefreshTimer = setInterval(function () {
                if (typeof document !== "undefined" && document.hidden) {
                    return;
                }
                refreshPipelineMonitorModel(that.getModel());
            }, iMs);
        },

        exit: function () {
            if (this._oPipelineRefreshTimer) {
                clearInterval(this._oPipelineRefreshTimer);
                this._oPipelineRefreshTimer = null;
            }
            AppComponent.prototype.exit.apply(this, arguments);
        }
    });
});
`

const INDEX_HTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${APP_TITLE}</title>
    <script
        id="sap-ui-bootstrap"
        src="https://ui5.sap.com/resources/sap-ui-core.js"
        data-sap-ui-theme="sap_horizon"
        data-sap-ui-resourceroots='{"${APP_ID}": "./"}'
        data-sap-ui-oninit="module:sap/ui/core/ComponentSupport"
        data-sap-ui-compatVersion="edge"
        data-sap-ui-async="true"></script>
</head>
<body class="sapUiBody">
    <div data-sap-ui-component data-name="${APP_ID}" data-id="container" data-settings='{"id":"monitor"}'></div>
</body>
</html>
`

const LAUNCHPAGE_HTML = `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>cds-data-pipeline example</title>
    <script>
        window['sap-ushell-config'] = {
            defaultRenderer: 'fiori2',
            services: {
                NavTargetResolution: {
                    config: {
                        allowTestUrlComponentConfig: true,
                        enableClientSideTargetResolution: true
                    }
                }
            },
            renderers: {
                fiori2: {
                    componentData: {
                        config: {
                            enableSearch: false
                        }
                    }
                }
            },
            applications: {
                'pipeline-monitor': {
                    title: 'Pipeline Monitor',
                    subTitle: 'Admin',
                    description: 'Tracker + run history',
                    additionalInformation: 'SAPUI5.Component=${APP_ID}',
                    applicationType: 'URL',
                    url: './pipeline-monitor/webapp',
                    navigationMode: 'embedded'
                }
            }
        };
    </script>
    <script src="https://ui5.sap.com/test-resources/sap/ushell/bootstrap/sandbox.js"></script>
    <script
        src="https://ui5.sap.com/resources/sap-ui-core.js"
        data-sap-ui-libs="sap.m, sap.ushell, sap.fe.templates"
        data-sap-ui-compatVersion="edge"
        data-sap-ui-theme="sap_horizon"
        data-sap-ui-frameOptions="allow"
        data-sap-ui-bindingSyntax="complex"
        data-sap-ui-async="true"></script>
    <script>
        sap.ui.getCore().attachInit(function () {
            sap.ushell.Container.createRenderer().placeAt('content');
        });
    </script>
</head>
<body class="sapUiBody" id="content"></body>
</html>
`

const I18N = `appTitle=${APP_TITLE}\n`

function writeIfChanged(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return
    fs.writeFileSync(filePath, content)
    // eslint-disable-next-line no-console
    console.log('wrote', path.relative(process.cwd(), filePath))
}

const ROOT = __dirname
const WEBAPP = path.join(ROOT, 'pipeline-monitor', 'webapp')
writeIfChanged(path.join(WEBAPP, 'manifest.json'), JSON.stringify(manifest(), null, 2) + '\n')
writeIfChanged(path.join(WEBAPP, 'Component.js'), COMPONENT_JS)
writeIfChanged(path.join(WEBAPP, 'index.html'), INDEX_HTML)
writeIfChanged(path.join(WEBAPP, 'i18n', 'i18n.properties'), I18N)
writeIfChanged(path.join(ROOT, 'launchpage.html'), LAUNCHPAGE_HTML)

// eslint-disable-next-line no-console
console.log('Pipeline Monitor FE app regenerated under examples/_monitor-app/.')

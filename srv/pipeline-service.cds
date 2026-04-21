// Stub service definition so CAP auto-wires `srv/DataPipelineService.js`
// by name matching. Enables `cds.connect.to('DataPipelineService')` and
// removes the need for a global service locator.
//
// This service has no entities or actions — it is a code-only orchestrator
// used programmatically by the plugin to drive pipelines. The OData
// management surface lives in `DataPipelineManagementService.cds`.

@protocol: 'none'
service DataPipelineService {}

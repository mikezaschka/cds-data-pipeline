using { plugin.data_pipeline as pipeline } from '../db/index.cds';

service DataPipelineManagementService @(path: '/pipeline') {

    @readonly
    @(requires: 'authenticated-user')
    entity Pipelines as projection on pipeline.Pipelines;

    @readonly
    @(requires: 'authenticated-user')
    entity PipelineRuns as projection on pipeline.PipelineRuns;

    @(requires: 'PipelineRunner')
    action run(
        name    : String,
        mode    : String,
        trigger : String,
        async   : Boolean
    ) returns String;

    @(requires: 'PipelineRunner')
    action flush(name : String) returns String;

    @(requires: 'authenticated-user')
    function status(name : String) returns Pipelines;
}

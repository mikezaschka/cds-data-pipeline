using { logistics } from '../db/schema';

service LogisticsService @(path: '/odata/v4/logistics') {

    @readonly
    entity Carriers  as projection on logistics.Carriers;

    @readonly
    entity Shipments as projection on logistics.Shipments;

    @readonly
    entity TrackingEvents as projection on logistics.TrackingEvents;

    // Writeable archive target for `examples/04-move-to-service/`.
    // Exposed without @readonly so the remote ODataTargetAdapter can POST /
    // PATCH / DELETE rows through CAP's connected-service runtime.
    entity ShipmentArchive as projection on logistics.ShipmentArchive;
}

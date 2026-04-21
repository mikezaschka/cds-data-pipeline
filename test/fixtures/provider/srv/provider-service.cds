using { provider } from '../db/schema';

service ProviderService {
    @cds.redirection.target
    entity Customers as projection on provider.Customers;
    entity Products  as projection on provider.Products;
    entity Orders    as projection on provider.Orders;
    entity Addresses as projection on provider.Addresses;

    @cds.query.limit: { max: 2 }
    @cds.redirection.target: false
    entity PagedCustomers as projection on provider.Customers;
}

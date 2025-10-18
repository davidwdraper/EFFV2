To start ... baby steps. This is how we proceed:

1. Write an ADR as an .md download file, to clearly show we're on the same page.
2. Create a routePolicy.contract in shared contracts for both the request and the response.
3. Add get, post and put routePolicy endpoints (routes and handlers) to the svcfacilitator, initially mocking the handlers.
4. Write a smoke test for #3 to ensure the endpoints are answering correctly.
5. Write a stand-alone console app that can post and put, via the command line, routePolicy records to the routePolicy mongo collection. Add public access policy for the auth.create and auth.signon endpoints.
6. Complete the crud operations started in step #3.
7. smoke test the routePolicy GET for the auth endpoints setup in step #5.
8. Add a routePolicyGate middlware gate to the gateway. This step is done before JWT verification because it's a separate responsibility. It manages a routePolicy TTL cache, calls the svcfacilitator and blocks API calls that are private and don't have a JWT. Note that JWT validation happens in the next middleware gate.
9. smoke test the routePolicy by attempting a CRUD operation on the user service. The routePolicyGate should block the call as it will be missing a JWT.

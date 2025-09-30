svcconfig is loading. That is locked.
Lets build the svcfacilitator service next. It will have two endpoints, mirrorLoad(), and getUrlViaSlug(). We'll add the JWKS handling later. svcfacilitator has no DB.

My thoughts are we need svcfacilitator next to facilitate S2S calls. So lets focus on the following (one at a time - no big code drops):

0. build a shared Bootstrap class used by all service's index.ts
1. stand up svcfacilitator service
2. build SvcClient, focusing on the .call() method, and simultaneously build SvcReceiver.receive().
3. use step 2 to have the gateway call svcfacilitator/mirrorLoad
4. stand up the auth service (no minting yet)
5. build pass-through proxy routes into the gateway
6. use step 2 to enable calling auth service via the gateway
7. stand up the user service
8. modify the auth service to call the user server using step 2
9. smoke e2e client -> gateway -> auth -> user (no tokens/crypto yet)
10. build Crypto and JWT Mint classes that uses KMS factory object. Also build UserAuth class.
11. using step 10, modify the gateway to validate non-health and non-open calls
12. add step 10 to the step 2 classes and add JWKS handling to svcfacilitator (S2S security)
13. add auditing WAL, and audit service to the gateway (leverage previous project)
14. add gateway guardrails

For all of the above, build a new smoke test runner, and test at every point that makes sense. Avoid test god files.

At this point, we should be in a good place to rapidly drive out additional services.

So this is what we're going to do:

1. Build a standalone testing engine.
2. The engine code will live in the NV backend, and import the shared files.
3. It will read from a handler config file that holds the explicit path each handler's physical path.
4. Per handler, we will instantiate the index.ts file.
5. The test engine builds a mock environment to satisfy the needs of handlers running in test.
6. The test engine, after index.ts is instantiated, call the index's getSteps function. this provides with an instantiated list of handlers.
7. For each handler, we will pull from the handler config file, test ctx values to plug into the handler - one set per test scenario.
8. The underlying edge modules have to be refactored to use constructor injection of the real DbWrite, DbReader, etc., with mocked versions.
9. The test engine ripps though each handler with test code written. We use observation to design the test data to have a happy path, along with paths that trip the guards.

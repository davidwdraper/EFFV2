test-runner-design.md

\*\* Concepts

1. Test runner is a service executed via an http route
2. The controller will start a pipeline like all NV controllers
3. The pipeline's index.ts file will start a single handler
4. The handler will be a TS orchestrator that steps the test methodically

\*\* Design Features

1. Orchestrator. Extremely small/thin class that instantiates the necessary steps, similar to how pipelines run, but without the rigid context rails. Each design feature mentioned below, is a call into seperate TS class files.
2. A TestRunWriter. It records the start of every testrun, and is updateable at the test end with the ultimate status. The status can be: Started, FailedGuard, CompletedWithRaiErrors, CompletedWithFailedTests, CompletedGreen. Note that a status of Started without a final status indicates a test-runner internal error which should show up in the ERROR log. The writer also records start and end times. Total tests attempted, total passed, total failed. The writer makes an S2S call to test-log for the actual mongo write.
3. Guard: The guard shuts down the run if DB_STATE, DB_MOCKS and S2S_MOCKS are not configured correctly. If the guard rejects, it calls TestRunWriter with a FailedGuard status, and the service stops its run.
4. TreeWalker. Two versions: Version1: provides a single hard-coded path to a pipeline index.ts file that we intend to test. Version2: produces an array of all pipeline index.ts files in the entire backend.
5. IndexIterator. This is the outer loop, of the test-runner and orchestrates the internals

\*\* IndexIterator

For each index file:

1. Create a fresh HandlerContext and Controller derived from ControllerJsonBase
2. Load the index file.
3. Call index.getSteps(ctx: HandlerContext, controller: ControllerJsonBase) <== existing function
4. Fore each step (handler) returned from getSteps:
   - call a new function called runStep().
     It replaces: await this.runPipeline(ctx, steps)
     with
     await this.runStep(ctx, step)
     call hasTest() on the step's handler. If false iterate to next step.
   - call TestHandlerWriter to record start of the test. Adds the TestRunId as a foreign key.
   - call runTest() on the step's handler. runTest is in try/catch. If an error is caught, flag a RailError.
   - call TestHandlerWriter to record test status, as returned from runTest or the catch block.

The design of the test itself, the part that runs when runTest() is called is a seperate document.

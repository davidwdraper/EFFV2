// index.ts

import { app } from './src/app';
//import { connectToDB } from './src/db';
import { config } from './src/config';

const start = async () => {
  try {
    //await connectToDB();

    app.listen(config.port, () => {
      console.log(`[orchestrator-core] Running on port ${config.port}`);
    });
  } catch (err) {
    console.error('[orchestrator-core] Failed to start:', err);
    process.exit(1);
  }
};

start();

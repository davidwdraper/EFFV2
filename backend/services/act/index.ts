// index.ts
import app from './src/app';
import { config } from './src/config';
import { connectDB } from './src/db';

console.log('[Act index.ts] CWD:', process.cwd());

connectDB().then(() => {
  app.listen(config.port, () => {
    console.log(`Act running on port ${config.port}`);
  });
});

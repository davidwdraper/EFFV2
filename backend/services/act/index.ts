// index.ts
import app from './src/app';
import { config } from './src/config';

console.log('[Act index.ts] CWD:', process.cwd());
app.listen(config.port, () => {
  console.log(`Act running on port ${config.port}`);
});

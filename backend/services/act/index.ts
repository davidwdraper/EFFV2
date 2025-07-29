// index.ts
import app from './src/app';
import { config } from './src/config';

app.listen(config.port, () => {
  console.log(`Act running on port ${config.port}`);
});

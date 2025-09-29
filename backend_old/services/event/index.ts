// index.ts
import app from './src/app';
import { config } from './src/config';

const PORT = process.env.EVENT_PORT || config.port || 4004;

app.listen(PORT, () => {
  console.log(`Event service running on port ${PORT}`);
});

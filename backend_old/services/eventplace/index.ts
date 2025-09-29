// index.ts
import app from './src/app';
import { config } from './src/config';

const PORT = process.env.EVENTPLACE_PORT || config.port || 4009;

app.listen(PORT, () => {
  console.log(`EventPlace service running on port ${PORT}`);
});

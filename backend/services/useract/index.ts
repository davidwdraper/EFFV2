// index.ts
import app from './src/app';
import { config } from './src/config';

const PORT = process.env.USERACT_PORT || config.port || 4007;

app.listen(PORT, () => {
  console.log(`UserAct service running on port ${PORT}`);
});

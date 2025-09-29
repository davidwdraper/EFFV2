// index.ts
import app from './src/app';
import { config } from './src/config';

const PORT = process.env.EVENTACT_PORT || config.port || 4008;

app.listen(PORT, () => {
  console.log(`EventAct service running on port ${PORT}`);
});

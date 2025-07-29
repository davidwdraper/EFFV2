// index.ts
import app from './src/app';
import { config } from './src/config';

const PORT = process.env.USER_PORT || config.port || 4001;

app.listen(PORT, () => {
  console.log(`User service running on port ${PORT}`);
});

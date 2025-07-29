// index.ts
import app from './src/app';
import { config } from './src/config';

const PORT = process.env.AUTH_PORT || config.port || 4006;

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});

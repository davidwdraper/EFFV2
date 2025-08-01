import { connectDB } from './src/db';
import app from './src/app';
import { config } from './src/config';

(async () => {
  await connectDB();
  app.listen(config.port, () => {
    console.log(`[UserService] Listening on port ${config.port}`);
  });
})();

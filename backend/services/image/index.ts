import app from './app';
import { connectDB } from './db';
import { config } from './config';

const start = async () => {
  await connectDB();

  app.listen(config.port, () => {
    console.log(`Image service running on port ${config.port}`);
  });
};

start();

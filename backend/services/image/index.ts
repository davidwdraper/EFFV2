import app from './app';
import { connectToDB } from './db';
import { config } from './config';

const start = async () => {
  await connectToDB();

  app.listen(config.port, () => {
    console.log(`Image service running on port ${config.port}`);
  });
};

start();

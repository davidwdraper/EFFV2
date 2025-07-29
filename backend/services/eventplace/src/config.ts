export const config = {
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/eff_eventplace_db',
  port: parseInt(process.env.EVENTPLACE_PORT || '4009', 10),
};

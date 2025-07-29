// src/config.ts
export const config = {
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/eff_useract_db',
  port: parseInt(process.env.USERACT_PORT || '4007', 10)
};

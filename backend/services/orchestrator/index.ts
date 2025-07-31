import app from './src/app';
import dotenv from 'dotenv';

import { logger } from '@shared/utils/logger';

dotenv.config();
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info('Logger import works!', { scope: 'startup' });
  console.log(`Orchestrator listening on port ${PORT}`);
});

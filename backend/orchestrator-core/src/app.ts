import express from 'express';
import cors from 'cors';

import coreCompositeRoutes from './routes/compositeRoutes';

const app = express();

app.use(cors());
app.use(express.json());

// 🔗 Route bindings — no index.ts
app.use('/Users', coreCompositeRoutes);

export { app };

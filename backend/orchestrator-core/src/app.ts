import express from 'express';
import cors from 'cors';

import coreUserRoutes from './routes/userRoutes';
import coreEventRoutes from './routes/eventRoutes';
import coreActRoutes from './routes/actRoutes';
import corePlaceRoutes from './routes/placeRoutes';
import coreCompositeRoutes from './routes/compositeRoutes';

const app = express();

app.use(cors());
app.use(express.json());

// 🔗 Route bindings — no index.ts
app.use('/Users', coreUserRoutes);
app.use('/Events', coreEventRoutes);
app.use('/Acts', coreActRoutes);

export { app };

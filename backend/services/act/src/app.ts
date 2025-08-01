import express from 'express';
import '@shared/types/express'; // 👈 Add this line
import './db';
import actRoutes from './routes/actRoutes';

const app = express();

app.use(express.json());
app.use('/acts', actRoutes);

export default app;

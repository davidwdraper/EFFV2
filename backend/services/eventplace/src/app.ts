import express from 'express';
import eventPlaceRoutes from './routes/eventPlaceRoutes';
import bodyParser from 'body-parser';
import './db'; // database connection

const app = express();

app.use(bodyParser.json());
app.use('/eventplaces', eventPlaceRoutes);

export default app;

// src/app.ts
import express from "express";
import { connectDB } from "./db";
import logRoutes from "./routes/logRoutes";
import "@shared/types/express"; // enables req.user in TS

const app = express();

connectDB();

app.use(express.json());
app.use("/log", logRoutes);

export default app;

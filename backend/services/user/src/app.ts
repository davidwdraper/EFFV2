// src/app.ts
import express from "express";
import "./db";
import userRoutes from "./routes/userRoutes";
import "@shared/types/express";

const app = express();

app.use(express.json());
app.use("/users", userRoutes);

export default app;

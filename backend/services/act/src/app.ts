import express from "express";
import "@shared/types/express"; // Shared request typing
import "./db";

import actRoutes from "./routes/actRoutes";
import townRoutes from "./routes/townRoutes"; // 👈 New towns endpoint

const app = express();

app.use(express.json());

// Routes
app.use("/acts", actRoutes);
app.use("/towns", townRoutes); // 👈 Mount towns inside Act service

export default app;

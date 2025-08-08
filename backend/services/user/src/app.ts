// src/app.ts
import express from "express";
import "./db";
import userRoutes from "./routes/userRoutes";
import userPublicRoutes from "./routes/userPublicRoutes"; // ✅ NEW
import "@shared/types/express";

const app = express();

app.use(express.json());

// Existing user routes (auth-required stuff, CRUD, etc.)
app.use("/users", userRoutes);

// Public, names-only endpoint used by other services for DTO enrichment
// GET /users/public/names?ids=ID1,ID2 -> { names: { "ID1": "First M Last", ... } }
app.use("/users", userPublicRoutes); // ✅ NEW

export default app;

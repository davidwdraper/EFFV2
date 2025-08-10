import express from "express";
import cors from "cors";
// body-parser is built-in now; use express.json
import imageRoutes from "./routes/imageRoutes";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Mount at root — your routes file already includes /images/... and /image
app.use("/", imageRoutes);

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true, svc: "image" }));

export default app;

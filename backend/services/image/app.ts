// backend/services/image/src/app.ts
import express from "express";
import imageRoutes from "./routes/imageRoutes";

const app = express();

// JSON parser (multipart is handled by multer in routes)
app.use(express.json({ limit: "10mb" }));

// Mount at root — routes already include /images/... and /image
app.use("/", imageRoutes);

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true, svc: "image" }));

export default app;

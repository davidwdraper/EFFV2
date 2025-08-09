import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import imageRoutes from "./routes/imageRoutes";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

app.use("/images", imageRoutes);

export default app;

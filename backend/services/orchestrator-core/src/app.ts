import express from "express";
import cors from "cors";
import coreCompositeRoutes from "./routes/compositeRoutes";
import userProxyRoutes from "./routes/userProxyRoutes";

const app = express();

app.use(cors());
app.use(express.json());

// 🔗 Route bindings — no index.ts
app.use("/users", userProxyRoutes);
app.use("/users/composite", coreCompositeRoutes);

export { app };

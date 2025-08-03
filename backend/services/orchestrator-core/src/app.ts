import express from "express";
import cors from "cors";
import coreCompositeRoutes from "./routes/compositeRoutes";
import userProxyRoutes from "./routes/userProxyRoutes";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/users/composite", coreCompositeRoutes);
app.use("/users", userProxyRoutes);

export { app };

import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { logger } from "@shared/utils/logger";
import { serviceName } from "./config";
import { serviceProxy } from "./middleware/serviceProxy";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

app.use(cors());
app.use((req, res, next) => {
  res.setHeader("x-minimal", "1");
  next();
});

app.use(
  pinoHttp({
    logger: logger.child({ service: serviceName, mode: "minimal" }),
    genReqId: (req, res) => {
      const hdr = req.headers["x-request-id"];
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
      res.setHeader("x-request-id", String(id));
      return String(id);
    },
  })
);

// CRITICAL: no body parsers. proxy first.
app.use("/_raw", serviceProxy({ stripSegments: 1 }));
app.use("/", serviceProxy());

app.get("/__who", (_req, res) =>
  res.json({ service: serviceName, mode: "minimal" })
);

// no error wrappers; let proxy speak

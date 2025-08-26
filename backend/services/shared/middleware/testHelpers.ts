// backend/services/shared/middleware/testHelpers.ts
import type express from "express";

export function addTestOnlyHelpers(app: express.Express, basePaths: string[]) {
  if (process.env.NODE_ENV !== "test") return;

  const triggerNonFinite = (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    const err = new Error("nonfinite status test") as any;
    (err as any).status = "not-a-number";
    next(err);
  };

  // Base paths and aliases (/, /service, /<entity>)
  app.get("/__err-nonfinite", triggerNonFinite);
  app.get("/__error/nonfinite", triggerNonFinite);
  for (const p of basePaths) {
    app.get(`${p}/__err-nonfinite`, triggerNonFinite);
    app.get(`${p}/__error/nonfinite`, triggerNonFinite);

    const doAuditFlush = (req: express.Request, res: express.Response) => {
      req.audit?.push({ type: "TEST_AUDIT", note: "flush" });
      res.status(204).send();
    };
    app.post("/__audit", doAuditFlush);
    app.post("/__audit-flush", doAuditFlush);
    app.post("/__audit/flush", doAuditFlush);
    app.post(`${p}/__audit`, doAuditFlush);
    app.post(`${p}/__audit-flush`, doAuditFlush);
    app.post(`${p}/__audit/flush`, doAuditFlush);
  }
}

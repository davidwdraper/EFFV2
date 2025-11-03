// backend/services/shared/src/http/handlers/DbManagerHandler.ts
/**
 * Purpose:
 * - Generic, single-purpose handler wrapper for DB managers (Writer/Reader/etc.)
 * - You supply:
 *    - the context key to fetch the manager (e.g., "dbWriter" or "dbReader")
 *    - the async operation to run on that manager
 *    - how to map success into { result, context updates }
 *    - optional duplicate-key downgrader (if the op can duplicate)
 */

import { HandlerBase } from "./handlers/HandlerBase";
import { HandlerContext } from "./handlers/HandlerContext";
import { DuplicateKeyError } from "../dto/persistence/adapters/mongo/dupeKeyError";

type SuccessMapper<TRes> = (ctx: HandlerContext, res: TRes) => void;
type OpFn<TMgr, TRes> = (mgr: TMgr) => Promise<TRes>;
type DupDowngrade = (ctx: HandlerContext, err: DuplicateKeyError) => void;

export class DbManagerHandler<TMgr, TRes> extends HandlerBase {
  constructor(
    ctx: HandlerContext,
    private readonly ctxKey: string,
    private readonly op: OpFn<TMgr, TRes>,
    private readonly onSuccess: SuccessMapper<TRes>,
    private readonly onDuplicate?: DupDowngrade
  ) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const mgr = this.ctx.get<TMgr>(this.ctxKey);
    if (!mgr) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DB_MANAGER_MISSING",
        message: `Context key "${this.ctxKey}" missing. Ops: verify prior handler sets ctx.set("${this.ctxKey}", ...)`,
      });
      this.log.debug(
        { event: "execute_error", ctxKey: this.ctxKey },
        "DbManager missing"
      );
      return;
    }

    try {
      const res = await this.op(mgr);
      this.onSuccess(this.ctx, res);
      this.ctx.set("handlerStatus", "ok");
    } catch (err: any) {
      if (this.onDuplicate && err instanceof DuplicateKeyError) {
        this.onDuplicate(this.ctx, err);
        this.ctx.set("handlerStatus", "warn"); // finalize() → 200 with result + warnings
        this.log.warn(
          {
            event: "duplicate_key",
            index: err.index,
            key: err.key,
            detail: err.message,
          },
          "DB op duplicate — downgraded to WARN"
        );
        return;
      }

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DB_OP_FAILED",
        message:
          "Database operation failed. Ops: see detail and correlate with requestId.",
        detail: String(err?.message ?? err),
      });
      this.log.debug(
        { event: "execute_error", error: String(err?.message ?? err) },
        "DB op failed"
      );
    }
  }
}

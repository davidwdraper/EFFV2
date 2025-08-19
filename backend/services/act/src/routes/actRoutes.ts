import { Router } from "express";
import * as ActController from "../controllers/actController";

const router = Router();

// one-liners only — no logic here
router.get("/ping", ActController.ping);
router.get("/", ActController.list); // GET /acts?name=…&limit=&offset=
router.get("/:id", ActController.getById); // GET /acts/:id
router.post("/", ActController.create); // POST /acts
router.put("/:id", ActController.update); // PUT /acts/:id
router.delete("/:id", ActController.remove); // DELETE /acts/:id

export default router;

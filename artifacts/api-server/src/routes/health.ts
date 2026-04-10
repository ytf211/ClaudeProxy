import { Router, type IRouter } from "express";
import { providerHealth } from "./proxy";

const router: IRouter = Router();

const startedAt = Math.floor(Date.now() / 1000);

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", startedAt, providers: providerHealth });
});

export default router;

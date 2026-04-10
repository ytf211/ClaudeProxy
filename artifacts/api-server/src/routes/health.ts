import { Router, type IRouter } from "express";

const router: IRouter = Router();

const startedAt = Math.floor(Date.now() / 1000);

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", startedAt });
});

export default router;

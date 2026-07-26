import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AppContainer } from "../core/AppContainer.js";
import { createAmoCrmRouter } from "./routes/amocrm.js";
import { createWidgetRouter } from "./routes/widget.js";

export function createServer(app: AppContainer) {
  const server = express();
  server.use(cors());
  server.use(express.json({ limit: "10mb" }));

  server.get("/health", (_req, res) => {
    res.json({ status: "ok", amoCrmConfigured: Boolean(app.amoCrm) });
  });

  server.use("/api", createWidgetRouter(app));
  server.use("/api/amocrm", createAmoCrmRouter(app));

  server.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    const message = err instanceof Error ? err.message : "Internal error";
    res.status(400).json({ error: message });
  });

  return server;
}

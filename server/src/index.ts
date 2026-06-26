import express from "express";
import cors from "cors";
import { config, isLiveMode } from "./config.js";
import { logBootSummary, recordClientUrl, startStatusReporter, trackHttp } from "./logger.js";
import { router } from "./routes.js";
import { runStartupChecks } from "./startup.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", (req, res, next) => {
  const referer = req.get("referer");
  if (referer) recordClientUrl(referer);

  const path = `${req.baseUrl}${req.path}`;
  const track = trackHttp(req.method, path);
  res.on("finish", () => {
    const failed = res.statusCode >= 400;
    if (failed) track.fail(`HTTP ${res.statusCode}`);
    else track.done(`HTTP ${res.statusCode}`);
  });
  next();
});

app.use("/api", router);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(`${new Date().toISOString()} [prism] request error:`, err);
    res.status(500).json({ error: "internal error" });
  },
);

async function main() {
  await runStartupChecks();
  startStatusReporter();
  logBootSummary(config.port);

  app.listen(config.port, () => {
    console.log(
      `[prism] listening http://localhost:${config.port} (${isLiveMode() ? "LIVE" : "SAMPLE"})`,
    );
  });
}

main().catch((err) => {
  console.error("[prism] boot failed:", err);
  process.exit(1);
});

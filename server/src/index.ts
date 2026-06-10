import express from "express";
import cors from "cors";
import { config, isLiveMode } from "./config.js";
import { router } from "./routes.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", router);

// Centralized error handler — never leak a stack to the client.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[prism] request error:", err);
    res.status(500).json({ error: "internal error" });
  },
);

app.listen(config.port, () => {
  console.log(
    `[prism] server on http://localhost:${config.port} — mode: ${
      isLiveMode() ? "LIVE" : "SAMPLE (set OPENROUTER_API_KEY + ALPHAVANTAGE_API_KEY for live)"
    }`,
  );
});

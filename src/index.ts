import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import authRouter from "./routes/auth";
import { authRateLimit } from "./lib/rateLimiter";

const app = express();

// Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
app.use(helmet());

// Trust first proxy hop for correct IP-based rate-limiting behind load balancers
app.set("trust proxy", 1);

// Middleware — explicit 10 kb body limit to prevent large-payload attacks
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

// Routes
app.use("/auth", authRateLimit, authRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;

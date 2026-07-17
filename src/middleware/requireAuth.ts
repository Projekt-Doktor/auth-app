import type { Request, Response, NextFunction } from "express";
import { parseSession } from "../lib/auth/session";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = parseSession(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Attach session to request for downstream handlers
  res.locals.session = session;
  next();
}

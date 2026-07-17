import jwt from "jsonwebtoken";
import type { Response, Request } from "express";

const COOKIE_NAME = "auth_token";

export interface SessionPayload {
  sub: string;   // user id
  email: string;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

export function issueSession(res: Response, payload: SessionPayload): void {
  const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";
  const token = jwt.sign(payload, jwtSecret(), { expiresIn } as jwt.SignOptions);

  // 7 days in ms
  const maxAge = 7 * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge,
    path: "/",
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function parseSession(req: Request): SessionPayload | null {
  const token: string | undefined = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  try {
    const payload = jwt.verify(token, jwtSecret()) as SessionPayload;
    return payload;
  } catch {
    return null;
  }
}

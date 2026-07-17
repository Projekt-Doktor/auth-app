# auth-app — Project Dossier

> Passwordless authentication via email magic links
> Stack: Node.js · TypeScript · Express · Prisma · PostgreSQL · Resend · JWT

---

## Table of Contents

1. [Product Requirements](#1-product-requirements)
2. [Architecture](#2-architecture)
3. [Data Model](#3-data-model)
4. [Authentication Flow](#4-authentication-flow)
5. [API Reference](#5-api-reference)
6. [Security Model](#6-security-model)
7. [Deployment](#7-deployment)
8. [Delivery Milestones](#8-delivery-milestones)

---

## 1. Product Requirements

### Problem

Password-based authentication creates friction (forgotten passwords, resets) and risk (credential stuffing, phishing). Magic links eliminate both by using the user's email inbox as the second factor.

### Target Users

- Developers integrating auth into a Node.js / Express backend
- Applications where password management is not a core product concern

### Goals

| # | Goal |
|---|------|
| G1 | Users can register and log in with only an email address |
| G2 | No password is ever stored or transmitted |
| G3 | Sessions persist across page refreshes for 7 days |
| G4 | Invalid, expired, or reused links are rejected with clear messages |
| G5 | The system is resistant to abuse (rate limiting, token exhaustion) |

### Non-Goals

- OAuth / social login (out of scope for v1)
- Multi-factor authentication beyond the magic link
- Admin dashboard or user management UI

### User Stories

| ID | As a … | I want to … | So that … |
|----|--------|-------------|-----------|
| US-1 | visitor | submit my email and receive a sign-in link | I can log in without a password |
| US-2 | visitor | click the link in my email | I am authenticated and redirected to the app |
| US-3 | user | stay logged in between sessions | I don't have to sign in every visit |
| US-4 | user | log out | I can end my session on shared devices |
| US-5 | user | request a new link if mine expired | I am never permanently locked out |
| US-6 | developer | protect any route with a middleware guard | I can secure endpoints without repeated auth logic |

### Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Accept an email address, validate format, generate a token, send a magic link |
| FR-2 | Tokens expire after 15 minutes |
| FR-3 | Tokens are single-use; reuse is rejected |
| FR-4 | Requesting a new link invalidates any previous unused token for that email |
| FR-5 | On successful verification, upsert the user record and issue a JWT session cookie |
| FR-6 | Session cookie is `HttpOnly`, `Secure` (prod), `SameSite=Strict`, 7-day `Max-Age` |
| FR-7 | A logout endpoint clears the session cookie |
| FR-8 | A protected `/auth/me` endpoint returns the current user's profile |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Magic-link endpoint: max 5 requests per IP per 10 minutes |
| NFR-2 | All auth routes: max 30 requests per IP per 15 minutes |
| NFR-3 | JSON body payloads capped at 10 KB |
| NFR-4 | Security headers on every response (Helmet) |
| NFR-5 | Zero known vulnerabilities in production dependencies (`npm audit`) |
| NFR-6 | TypeScript strict mode; all types checked at build time |

---

## 2. Architecture

### System Overview

```
┌─────────────────────────────────────────────────────┐
│                    Client (Browser)                  │
└───────────────────────┬─────────────────────────────┘
                        │ HTTPS
┌───────────────────────▼─────────────────────────────┐
│                  Express Server                      │
│                                                      │
│  helmet()  ──  rate-limit  ──  cookie-parser         │
│                                                      │
│  POST /auth/magic-link                               │
│  GET  /auth/verify                                   │
│  POST /auth/logout      ──  requireAuth middleware   │
│  GET  /auth/me          ──  requireAuth middleware   │
└───────┬──────────────────────────┬───────────────────┘
        │                          │
┌───────▼────────┐        ┌────────▼────────┐
│  PostgreSQL     │        │  Resend API     │
│  (Prisma ORM)  │        │  (email send)   │
│                │        └─────────────────┘
│  users         │
│  magic_link_   │
│    tokens      │
└────────────────┘
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|---------------|
| Entry point | `src/index.ts` | Bootstrap Express, attach global middleware |
| Auth router | `src/routes/auth.ts` | Route definitions and request orchestration |
| Token lib | `src/lib/auth/token.ts` | CSPRNG generation, SHA-256 hashing, atomic DB verification |
| Session lib | `src/lib/auth/session.ts` | JWT sign / verify / cookie management |
| Email lib | `src/lib/auth/email.ts` | Resend client, URL construction, template loading |
| Rate limiter | `src/lib/rateLimiter.ts` | express-rate-limit instances |
| Auth guard | `src/middleware/requireAuth.ts` | JWT validation middleware for protected routes |
| Prisma client | `src/lib/prisma.ts` | Singleton client with dev hot-reload guard |

### Key Design Decisions

**Hash-before-store**
The raw token is sent only in the email URL and never written to the database. The database stores a SHA-256 hash. A database breach exposes no usable tokens.

**Atomic token consumption**
Verification uses a single `UPDATE … WHERE used_at IS NULL AND expires_at > NOW() RETURNING *` statement. This eliminates the TOCTOU (time-of-check / time-of-use) race condition that a separate SELECT + UPDATE would introduce.

**Stateless JWT sessions**
No session table is required. The JWT payload (`sub`, `email`) is self-contained and verified on every request using the shared `JWT_SECRET`. Logout clears the cookie client-side; server-side revocation requires a deny-list (future work).

---

## 3. Data Model

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` PK | `DEFAULT uuid_generate_v4()` |
| `email` | `VARCHAR` UNIQUE | Normalised to lowercase by Prisma |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated |

### `magic_link_tokens`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` PK | |
| `email` | `VARCHAR` | FK → `users.email` |
| `token_hash` | `VARCHAR` UNIQUE | SHA-256 hex of raw token |
| `expires_at` | `TIMESTAMPTZ` | `NOW() + 15 minutes` |
| `used_at` | `TIMESTAMPTZ` NULL | Set atomically on first use |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` |

**Indexes**: `token_hash` (unique lookup), `email` (rate-limit queries, invalidation)

---

## 4. Authentication Flow

### Request a magic link

```
Client                    Server                   DB              Email
  │                          │                      │                │
  │  POST /auth/magic-link   │                      │                │
  │  { email }               │                      │                │
  │─────────────────────────►│                      │                │
  │                          │  validate email (Zod)│                │
  │                          │  rate-limit check    │                │
  │                          │─────────────────────►│                │
  │                          │  updateMany: expire  │                │
  │                          │  prior tokens        │                │
  │                          │◄─────────────────────│                │
  │                          │  create token record │                │
  │                          │─────────────────────►│                │
  │                          │◄─────────────────────│                │
  │                          │                                       │
  │                          │──────── send magic link email ───────►│
  │                          │                                       │
  │  200 { message }         │                                       │
  │◄─────────────────────────│                                       │
```

### Verify the magic link

```
Client (email click)       Server                   DB
  │                          │                      │
  │  GET /auth/verify        │                      │
  │  ?token=<raw>            │                      │
  │─────────────────────────►│                      │
  │                          │  hash(raw)           │
  │                          │                      │
  │                          │  findUnique(hash)   ─┤ → not found → 400
  │                          │  check usedAt       ─┤ → used     → 400
  │                          │  check expiresAt    ─┤ → expired  → 400
  │                          │                      │
  │                          │  UPDATE token        │
  │                          │  WHERE used_at IS NULL
  │                          │  AND expires_at > NOW()
  │                          │  RETURNING email    ─┤ → 0 rows (race) → 400
  │                          │◄─────────────────────│
  │                          │                      │
  │                          │  upsert user         │
  │                          │─────────────────────►│
  │                          │◄─────────────────────│
  │                          │                      │
  │  302 → /dashboard        │                      │
  │  Set-Cookie: auth_token  │                      │
  │◄─────────────────────────│                      │
```

---

## 5. API Reference

### `POST /auth/magic-link`

Request a magic link for an email address.

**Rate limit**: 5 requests / IP / 10 min

**Request**

```json
{ "email": "user@example.com" }
```

**Responses**

| Status | Body | Condition |
|--------|------|-----------|
| 200 | `{ "message": "If that address is valid, a sign-in link is on its way." }` | Always (avoids email enumeration) |
| 400 | `{ "error": "Invalid email address" }` | Malformed email |
| 429 | `{ "error": "Too many requests. Please wait before requesting another link." }` | Rate limit hit |
| 500 | `{ "error": "Failed to send magic link. Please try again." }` | DB or email error |

---

### `GET /auth/verify?token=<raw>`

Consume a magic link token and issue a session.

**Responses**

| Status | Body / Behaviour | Condition |
|--------|-----------------|-----------|
| 302 | Redirect to `APP_URL/dashboard`, sets `auth_token` cookie | Valid token |
| 400 | `{ "error": "Missing token" }` | No `token` query param |
| 400 | `{ "error": "Invalid or expired link. Please request a new one." }` | Token not found or expired |
| 400 | `{ "error": "This link has already been used. Please request a new one." }` | Token already consumed |
| 500 | `{ "error": "Internal error. Please request a new link." }` | DB error |

**Cookie set on success**

```
auth_token=<JWT>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800
```

---

### `POST /auth/logout`

Clear the session cookie.

**Auth required**: yes (session cookie)

**Responses**

| Status | Body |
|--------|------|
| 200 | `{ "message": "Logged out successfully." }` |
| 401 | `{ "error": "Unauthorized" }` |

---

### `GET /auth/me`

Return the current user's profile.

**Auth required**: yes (session cookie)

**Response 200**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "createdAt": "2026-07-17T16:00:00.000Z"
}
```

| Status | Condition |
|--------|-----------|
| 200 | Authenticated, user found |
| 401 | No or invalid session cookie |
| 404 | User record deleted after session was issued |

---

### `GET /health`

Liveness check.

**Response 200**

```json
{ "status": "ok" }
```

---

## 6. Security Model

### Token Security

| Property | Implementation |
|----------|---------------|
| Entropy | `crypto.randomBytes(32)` → 256 bits |
| Encoding | `base64url` (URL-safe, no padding) |
| Storage | SHA-256 hash only; raw token lives only in memory and the email URL |
| Comparison | `crypto.timingSafeEqual` prevents timing side-channels |
| Expiry | 15 minutes from creation |
| Single-use | Atomic `UPDATE … WHERE used_at IS NULL` |
| Invalidation | Previous unused tokens for the same email are expired on new request |

### Session Security

| Property | Implementation |
|----------|---------------|
| Algorithm | HS256 JWT signed with `JWT_SECRET` |
| Transport | `HttpOnly; Secure; SameSite=Strict` cookie |
| Lifetime | 7 days (`Max-Age=604800`) |
| Storage | Stateless — no server-side session store |
| Revocation | Cookie cleared on logout; server-side revocation requires a deny-list (future) |

### Network & Application Security

| Control | Implementation |
|---------|---------------|
| Security headers | `helmet()` — sets `X-Content-Type-Options`, `X-Frame-Options`, `HSTS`, `Referrer-Policy`, etc. |
| Rate limiting | `express-rate-limit` keyed by IP (respects `X-Forwarded-For` via `trust proxy`) |
| Body size | `express.json({ limit: "10kb" })` |
| Input validation | Zod schema on all user-supplied fields |
| SQL injection | Prisma ORM parameterised queries; raw query uses tagged template literal |
| Error messages | Generic user-facing messages; detailed errors only in server logs |
| Email enumeration | `/auth/magic-link` always returns 200 regardless of whether the email exists |

### Known Limitations

| Limitation | Mitigation / Future Work |
|------------|--------------------------|
| No JWT revocation | Add a Redis-backed deny-list keyed by `jti` for logout-on-all-devices |
| IP-only rate limiting | Supplement with per-email rate limiting at the application layer |
| No CORS configuration | Add `cors()` with an explicit origin allowlist before going cross-origin |
| Stateless logout | Cleared client-side only; stolen cookies remain valid until expiry |

---

## 7. Deployment

### Environment Variables

| Variable | Required | Example |
|----------|----------|---------|
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/auth_app` |
| `JWT_SECRET` | yes | 32+ random characters |
| `JWT_EXPIRES_IN` | no | `7d` (default) |
| `RESEND_API_KEY` | yes | `re_…` |
| `EMAIL_FROM` | yes | `noreply@yourdomain.com` |
| `APP_URL` | yes | `https://yourdomain.com` |
| `PORT` | no | `3000` (default) |
| `NODE_ENV` | yes | `production` |

### Checklist

- [ ] `NODE_ENV=production` set (enables `Secure` cookie flag)
- [ ] `JWT_SECRET` is a random string ≥ 32 characters, stored as a secret (not in source)
- [ ] `APP_URL` matches the actual public URL (used for magic link and redirect)
- [ ] Sending domain verified in Resend with SPF + DKIM records
- [ ] `trust proxy` is appropriate for your hosting setup (currently set to `1`)
- [ ] Database migrations applied: `npx prisma migrate deploy`
- [ ] `npm ci` used in CI/CD (reproducible installs from lock file)

### Build

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm start
```

---

## 8. Delivery Milestones

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Data model + Prisma schema | done |
| 2 | Token generation, hashing, atomic verification | done |
| 3 | Session management (JWT + HttpOnly cookie) | done |
| 4 | API endpoints (`/magic-link`, `/verify`, `/logout`, `/me`) | done |
| 5 | Email template + Resend integration | done |
| 6 | Rate limiting + security headers | done |
| 7 | Unit + integration test suite (18 tests) | done |
| 8 | Security review + hardening | done |
| 9 | Frontend (login page, verify page, auth state) | pending |
| 10 | Server-side JWT revocation (Redis deny-list) | pending |
| 11 | Per-email rate limiting | pending |
| 12 | CORS configuration | pending |

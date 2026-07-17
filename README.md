# auth-app

Passwordless authentication for Node.js using email magic links.

## How it works

1. User submits their email address
2. A single-use, time-limited link is sent to that address via [Resend](https://resend.com)
3. Clicking the link verifies the token and issues a signed JWT session cookie
4. The cookie authenticates all subsequent requests

## Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **Database**: PostgreSQL via [Prisma](https://www.prisma.io)
- **Email**: Resend
- **Sessions**: JWT in an `HttpOnly` cookie
- **Tests**: Vitest

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/magic-link` | — | Request a magic link (`{ "email": "..." }`) |
| `GET` | `/auth/verify?token=<raw>` | — | Consume token, issue session, redirect to `/dashboard` |
| `POST` | `/auth/logout` | cookie | Clear session |
| `GET` | `/auth/me` | cookie | Return current user |
| `GET` | `/health` | — | Health check |

## Getting started

### Prerequisites

- Node.js ≥ 20
- PostgreSQL database
- [Resend](https://resend.com) account + verified sending domain

### Setup

```bash
git clone https://github.com/Projekt-Doktor/auth-app
cd auth-app
npm install
```

Copy the environment template and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Random secret ≥ 32 characters |
| `JWT_EXPIRES_IN` | Session lifetime (default: `7d`) |
| `RESEND_API_KEY` | Resend API key (`re_…`) |
| `EMAIL_FROM` | Verified sender address |
| `APP_URL` | Public base URL of the app |
| `PORT` | HTTP port (default: `3000`) |

### Database

```bash
npx prisma migrate dev --name init
```

### Run

```bash
npm run dev     # development (ts-node-dev, hot reload)
npm run build   # compile to dist/
npm start       # run compiled output
```

### Test

```bash
npm test
```

## Security

- Tokens are stored as SHA-256 hashes — the raw token never touches the database
- Token consumption uses an atomic `UPDATE … WHERE used_at IS NULL RETURNING *` to prevent race conditions
- Sessions use `HttpOnly; Secure; SameSite=Strict` cookies
- Rate limiting: 5 magic-link requests per IP per 10 minutes
- Security headers via [Helmet](https://helmetjs.github.io)
- Error messages are intentionally generic to avoid leaking token existence

## Project structure

```
src/
├── index.ts                  # Express entry point
├── lib/
│   ├── prisma.ts             # Prisma client singleton
│   ├── rateLimiter.ts        # express-rate-limit config
│   └── auth/
│       ├── token.ts          # Generate, hash, verify magic tokens
│       ├── session.ts        # JWT issue / parse / clear
│       └── email.ts          # Resend integration
├── middleware/
│   └── requireAuth.ts        # JWT session guard
├── routes/
│   └── auth.ts               # Auth endpoints
└── templates/
    └── magic-link.html       # Email template

tests/
└── auth/
    ├── token.test.ts         # Unit tests (token generation & hashing)
    └── flow.test.ts          # Integration tests (verify, session, middleware)
```

## License

MIT

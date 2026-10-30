# FashionApp

## Description
This is a web application for saving and organizing fashion outfits.

## Features
1. Save individual fashion items (tops, bottoms, dresses, outerwear, shoes, accessories)
2. Mark which items go together
3. Save outfits made from your items. While you pick, items that go with everything already picked are outlined
4. Organize outfits by categories or occasions
5. Search your items by name to see what each one goes with
6. Open any item, outfit or occasion to see everything linked to it on its own page
7. Accounts with a username and password. Everything you save is private to your account

## Tech stack
- **Front end:** React 19, React Router, CSS Modules (`src/react-app`)
- **Back end:** a [Hono](https://hono.dev/) API on [Cloudflare Workers](https://developers.cloudflare.com/workers/) (`src/worker`)
- **Database:** [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite). Tables are created by the files in `migrations/`
- **Shared types:** `src/shared`, used by both the front end and the Worker
- **Tests:** Jest and React Testing Library (`src/__tests__`)

Everything runs on the Cloudflare Workers **Free** plan.

## Getting started
You need [Node.js](https://nodejs.org/) 22.16 or newer (the tests use Node's built-in SQLite).

```bash
npm install
npm run db:migrate:local   # creates the tables in a local database (in .wrangler/)
npm run dev                # http://localhost:5173
```

Sign up from the **Log in** button in the top corner to start adding items.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Runs the app and the API locally with hot reload |
| `npm run build` | Type checks everything and builds for production |
| `npm run lint` | Runs ESLint |
| `npm test` | Runs the tests |
| `npm run test:watch` | Reruns the tests as you edit |
| `npm run test:coverage` | Runs the tests and writes a coverage report to `coverage/` |
| `npm run coverage:preview` | Opens the coverage report in your browser |
| `npm run db:migrate:local` | Applies new migrations to the local database |
| `npm run db:migrate:remote` | Applies new migrations to the deployed database |
| `npm run deploy` | Deploys to Cloudflare |
| `npm run cf-typegen` | Regenerates `worker-configuration.d.ts` after changing `wrangler.json` |

## Deploying
1. Log in to Cloudflare: `npx wrangler login`
2. Build and deploy: `npm run build && npm run deploy`

   The first deploy creates the D1 database and writes its `database_id` into `wrangler.json`. Commit that change.
3. Create the tables: `npm run db:migrate:remote`

   Run this right after the first deploy. The API returns errors until the tables exist.

After that, each release is: `npm run build && npm run deploy`, plus `npm run db:migrate:remote` when there's a new file in `migrations/`.

## Database changes
Never edit a migration that has already been applied. Make a new one instead:

```bash
npx wrangler d1 migrations create fashionapp-db describe_the_change
```

Write the SQL in the new file under `migrations/`, then apply it with `npm run db:migrate:local` (and `npm run db:migrate:remote` when you deploy).

## API
Everything is JSON under `/api`. All routes except sign up, log in and log out need you to be logged in (a session cookie).

| Route | Body | Returns |
|---|---|---|
| `POST /api/users/signup` | `{ username, password }` | `{ user }` and a session cookie |
| `POST /api/users/login` | `{ username, password }` | `{ user }` and a session cookie |
| `GET /api/users/me` | | `{ user }`, or 401 if logged out |
| `POST /api/users/logout` | | `{ ok }` |
| `GET` / `POST /api/items` | `{ name, type }` | `{ items }` / `{ item }` |
| `GET` / `DELETE /api/items/:id` | | `{ item }` / `{ ok }` |
| `PUT` / `DELETE /api/items/:id/compatible/:otherId` | | `{ item }` |
| `GET` / `POST /api/outfits` | `{ name, itemIds }` | `{ outfits }` / `{ outfit }` |
| `GET` / `DELETE /api/outfits/:id` | | `{ outfit }` / `{ ok }` |
| `GET` / `POST /api/occasions` | `{ name, outfitIds }` | `{ occasions }` / `{ occasion }` |
| `GET` / `DELETE /api/occasions/:id` | | `{ occasion }` / `{ ok }` |

Errors come back as `{ error: "message" }` with a 400, 401, 404, 409, 429 or 500 status.

Deleting an item also removes it from its outfits, and outfits left with no items are deleted. Deleting an outfit works the same way for occasions.

## Security
- Passwords are hashed with PBKDF2-SHA256 and a random salt per user. They are never stored or sent back.
- Sessions use an `httpOnly`, `SameSite=Lax` cookie. Only a SHA-256 hash of the session token is stored.
- Each username gets 5 login attempts per 15 minutes. After that, logins return 429 until the time is up, and a successful login resets the count.
- Every query is scoped to the logged-in user, so other users' items, outfits and occasions return 404.

## Project structure
```
src/
├── react-app/            front end
│   ├── api.ts            every call to the API
│   └── components/       one folder per component (Name.tsx + Name.module.css)
├── worker/               API on Cloudflare Workers
│   ├── index.ts          connects the routes
│   ├── routes/           users, items, outfits, occasions
│   ├── auth.ts           passwords and sessions
│   ├── db.ts             database helpers
│   └── http.ts           request checking
├── shared/types.ts       types used by both sides
└── __tests__/            one test file per folder above
migrations/               D1 tables
```

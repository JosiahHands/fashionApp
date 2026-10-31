import { Hono } from "hono";
import type { User } from "../../shared/types";
import {
	endSession,
	findSessionUser,
	hashPassword,
	requireUser,
	startSession,
	verifyPassword,
	type AppEnv,
} from "../auth";
import { nowSeconds, type SessionUser, type UserRow } from "../db";
import { badRequest, readJsonObject } from "../http";

export const users = new Hono<AppEnv>();

// Same rules as the sign up form.
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
const USERNAME_MAX_LENGTH = 30;
const PASSWORD_MIN_LENGTH = 8;
// Stops very long passwords from using up the CPU limit while hashing.
const PASSWORD_MAX_LENGTH = 200;

// Password guessing limit: tries per username per window.
const MAX_LOGIN_TRIES = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

// Only what the front end needs. The password hash never leaves the server.
function toUser(row: SessionUser): User {
	return { username: row.username };
}

// POST /api/users/signup  { username, password } → 201 { user } and a session cookie | 400 | 409
users.post("/signup", async (c) => {
	const body = await readJsonObject(c);
	const username = typeof body.username === "string" ? body.username.trim() : "";
	const password = body.password;
	if (!USERNAME_PATTERN.test(username)) {
		throw badRequest("Username must be 3–30 letters, numbers or underscores");
	}
	if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
		throw badRequest(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
	}
	if (password.length > PASSWORD_MAX_LENGTH) {
		throw badRequest(`Password must be ${PASSWORD_MAX_LENGTH} characters or fewer`);
	}

	// The username column ignores case, so "Jo" clashes with "jo".
	// ON CONFLICT covers it being taken, even by a sign up landing at the same moment.
	const user = await c.env.DB.prepare(
		`INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)
		ON CONFLICT DO NOTHING
		RETURNING id, username`,
	)
		.bind(crypto.randomUUID(), username, await hashPassword(password))
		.first<SessionUser>();
	if (!user) {
		return c.json({ error: "That username is taken" }, 409);
	}

	await startSession(c, user.id);
	return c.json({ user: toUser(user) }, 201);
});

// Counts one log in try for the username and returns how many it has had in the current window.
// Counting is one step (an upsert), so many guesses sent at once are all counted.
// Expired windows are deleted in the same batch, which also starts a fresh one for this username.
async function countLoginTry(db: D1Database, username: string) {
	const [, counted] = await db.batch([
		db
			.prepare("DELETE FROM login_attempts WHERE window_start <= unixepoch() - ?")
			.bind(LOGIN_WINDOW_SECONDS),
		db
			.prepare(
				`INSERT INTO login_attempts (username, attempts, window_start) VALUES (?, 1, unixepoch())
				ON CONFLICT (username) DO UPDATE SET attempts = attempts + 1
				RETURNING attempts, window_start`,
			)
			.bind(username.toLowerCase()),
	]);
	return (counted.results as { attempts: number; window_start: number }[])[0];
}

// "Too many failed login attempts. Try again in 12 minutes."
function tooManyTriesMessage(windowStart: number) {
	const minutes = Math.ceil((windowStart + LOGIN_WINDOW_SECONDS - nowSeconds()) / 60);
	return `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

// POST /api/users/login  { username, password } → 200 { user } and a session cookie | 400 | 401 | 429.
// Each username gets MAX_LOGIN_TRIES tries per LOGIN_WINDOW_SECONDS; a successful log in resets it.
users.post("/login", async (c) => {
	const body = await readJsonObject(c);
	const username = typeof body.username === "string" ? body.username.trim() : "";
	const password = typeof body.password === "string" ? body.password : "";
	if (username === "" || password === "") {
		throw badRequest("Enter your username and password");
	}
	// No account can have a longer username, so don't save a try for it.
	if (username.length > USERNAME_MAX_LENGTH) {
		return c.json({ error: "Incorrect username or password" }, 401);
	}

	// Checked before the password, so a locked username costs no hashing.
	const tries = await countLoginTry(c.env.DB, username);
	if (tries.attempts > MAX_LOGIN_TRIES) {
		return c.json({ error: tooManyTriesMessage(tries.window_start) }, 429);
	}
	if (password.length > PASSWORD_MAX_LENGTH) {
		return c.json({ error: "Incorrect username or password" }, 401);
	}

	const user = await c.env.DB.prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
		.bind(username)
		.first<UserRow>();
	// Same message whether the account doesn't exist or the password is wrong.
	if (!user || !(await verifyPassword(password, user.password_hash))) {
		return c.json({ error: "Incorrect username or password" }, 401);
	}

	await c.env.DB.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username.toLowerCase()).run();
	await startSession(c, user.id);
	return c.json({ user: toUser(user) });
});

// GET /api/users/me → 200 { user }, or { user: null } when nobody is logged in.
// Not a 401, because browsers log every 401 as an error and this one is expected on a logged-out page.
users.get("/me", async (c) => {
	const user = await findSessionUser(c);
	return c.json({ user: user ? toUser(user) : null });
});

// POST /api/users/logout → 200, ends the session and clears the cookie
users.post("/logout", async (c) => {
	await endSession(c);
	return c.json({ ok: true });
});

// DELETE /api/users/me  { password } → 200 | 400 | 401 | 403 | 429.
// Deletes the account and everything saved in it. Asks for the password again, so someone at an
// unattended logged-in browser can't do it, and wrong passwords count toward the log in limit.
users.delete("/me", requireUser, async (c) => {
	const db = c.env.DB;
	const { id, username } = c.var.user;
	const body = await readJsonObject(c);
	const password = typeof body.password === "string" ? body.password : "";
	if (password === "") {
		throw badRequest("Enter your password");
	}

	const tries = await countLoginTry(db, username);
	if (tries.attempts > MAX_LOGIN_TRIES) {
		return c.json({ error: tooManyTriesMessage(tries.window_start) }, 429);
	}
	const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(id).first<UserRow>();
	if (!row || password.length > PASSWORD_MAX_LENGTH || !(await verifyPassword(password, row.password_hash))) {
		// 403, not 401: they're still logged in, the password is just wrong.
		return c.json({ error: "Incorrect password" }, 403);
	}

	// Deleting the user also deletes their sessions, items, outfits and occasions (ON DELETE CASCADE).
	await db.batch([
		db.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username.toLowerCase()),
		db.prepare("DELETE FROM users WHERE id = ?").bind(id),
	]);
	await endSession(c);
	return c.json({ ok: true });
});

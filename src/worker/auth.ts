import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { nowSeconds, type SessionUser } from "./db";

// Hono env for every route: the Worker's bindings plus the logged-in user set by requireUser.
export type AppEnv = {
	Bindings: Env;
	Variables: { user: SessionUser };
};

// Hashing has to fit in the Workers Free plan's 10 ms CPU limit per request.
// Stored hashes record their own count, so raising this later doesn't break existing logins.
const PBKDF2_ITERATIONS = 10_000;
const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

const encoder = new TextEncoder();

// --- Passwords ---

// Stored as "pbkdf2-sha256$<iterations>$<salt>$<hash>" (base64).
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, iterations, salt, hash] = stored.split("$");
	if (scheme !== "pbkdf2-sha256" || !salt || !hash) {
		return false;
	}
	const expected = fromBase64(hash);
	const actual = await pbkdf2(password, fromBase64(salt), Number(iterations));
	return (
		actual.byteLength === expected.byteLength &&
		crypto.subtle.timingSafeEqual(actual, expected)
	);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
		"deriveBits",
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		key,
		256,
	);
	return new Uint8Array(bits);
}

// --- Sessions ---

// Saves a new session and sets its cookie. Only the token's hash is stored.
// Also clears out the user's expired sessions so they don't pile up.
export async function startSession(c: Context<AppEnv>, userId: string) {
	const token = toBase64(crypto.getRandomValues(new Uint8Array(32)));
	const maxAge = SESSION_DAYS * 24 * 60 * 60;
	await c.env.DB.batch([
		c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= unixepoch()").bind(
			userId,
		),
		c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(
			await sha256(token),
			userId,
			nowSeconds() + maxAge,
		),
	]);
	setCookie(c, SESSION_COOKIE, token, {
		path: "/",
		httpOnly: true,
		secure: new URL(c.req.url).protocol === "https:",
		sameSite: "Lax",
		maxAge,
	});
}

export async function endSession(c: Context<AppEnv>) {
	const token = getCookie(c, SESSION_COOKIE);
	if (token) {
		await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
	}
	deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

// Rejects with 401 unless the request has a valid, unexpired session; sets c.var.user.
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
	const token = getCookie(c, SESSION_COOKIE);
	const user = token
		? await c.env.DB.prepare(
				`SELECT users.id, users.username
				FROM sessions JOIN users ON users.id = sessions.user_id
				WHERE sessions.id = ? AND sessions.expires_at > unixepoch()`,
			)
				.bind(await sha256(token))
				.first<SessionUser>()
		: null;
	if (!user) {
		return c.json({ error: "Not logged in" }, 401);
	}
	c.set("user", user);
	await next();
});

// --- Encoding helpers ---

async function sha256(value: string): Promise<string> {
	return toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function toBase64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

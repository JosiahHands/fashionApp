// Tests for src/worker: every /api route, run through the real Hono app.
// D1 is replaced by an in-memory SQLite database (node:sqlite) built from the real migrations,
// so the real SQL, foreign keys and ON DELETE CASCADE rules are what's being tested.

import { timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Item, Occasion, Outfit, User } from "../shared/types";
import app from "../worker/index";

// Workers adds crypto.subtle.timingSafeEqual; Node only has it in node:crypto.
Object.defineProperty(crypto.subtle, "timingSafeEqual", {
	value: (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b),
});

const MIGRATIONS_DIR = join(__dirname, "../../migrations");

// --- Fake D1: just the methods the Worker uses ---

class FakeStatement {
	private readonly db: DatabaseSync;
	private readonly sql: string;
	private readonly params: SQLInputValue[];

	constructor(db: DatabaseSync, sql: string, params: SQLInputValue[] = []) {
		this.db = db;
		this.sql = sql;
		this.params = params;
	}

	bind(...values: SQLInputValue[]) {
		return new FakeStatement(this.db, this.sql, values);
	}

	// D1's first() returns the first row, or just one column of it when a name is given.
	async first(column?: string) {
		const row = asTestError(() => this.db.prepare(this.sql).get(...this.params)) as
			| Record<string, unknown>
			| undefined;
		if (!row) {
			return null;
		}
		return column ? row[column] : row;
	}

	async run() {
		return this.execute();
	}

	// What D1 gives back for one statement: its rows (if it returns any) and how many rows it changed.
	execute() {
		return asTestError(() => {
			const statement = this.db.prepare(this.sql);
			if (statement.columns().length > 0) {
				return { results: statement.all(...this.params), success: true, meta: { changes: 0 } };
			}
			const { changes } = statement.run(...this.params);
			return { results: [], success: true, meta: { changes: Number(changes) } };
		});
	}
}

// node:sqlite's errors come from outside Jest's sandbox, so `err instanceof Error` is false for them
// and Hono would rethrow instead of calling onError. Real D1 throws normal Errors, so copy them into one.
function asTestError<T>(run: () => T): T {
	try {
		return run();
	} catch (err) {
		throw new Error((err as Error).message);
	}
}

function createDatabase() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
		sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
	}
	const d1 = {
		prepare: (sql: string) => new FakeStatement(sqlite, sql),
		// D1 runs a batch as one transaction.
		batch: async (statements: FakeStatement[]) => {
			sqlite.exec("BEGIN");
			try {
				const results = statements.map((statement) => statement.execute());
				sqlite.exec("COMMIT");
				return results;
			} catch (err) {
				sqlite.exec("ROLLBACK");
				throw err;
			}
		},
	};
	return { sqlite, d1: d1 as unknown as D1Database };
}

// --- Request helpers ---

type ApiBody = {
	error?: string;
	ok?: boolean;
	user?: User;
	item?: Item;
	items?: Item[];
	outfit?: Outfit;
	outfits?: Outfit[];
	occasion?: Occasion;
	occasions?: Occasion[];
};

let sqlite: DatabaseSync;
let env: { DB: D1Database };

beforeEach(() => {
	const database = createDatabase();
	sqlite = database.sqlite;
	env = { DB: database.d1 };
	jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	sqlite.close();
	jest.restoreAllMocks();
});

// Sends one request to the app. Pass a cookie to be logged in.
async function call(method: string, path: string, options: { body?: unknown; cookie?: string; rawBody?: string } = {}) {
	const headers: Record<string, string> = {};
	if (options.cookie) {
		headers.Cookie = options.cookie;
	}
	let body: string | undefined;
	if (options.rawBody !== undefined) {
		body = options.rawBody;
		headers["Content-Type"] = "application/json";
	} else if (options.body !== undefined) {
		body = JSON.stringify(options.body);
		headers["Content-Type"] = "application/json";
	}
	const response = await app.request(`http://localhost${path}`, { method, headers, body }, env);
	const data = (await response.json()) as ApiBody;
	// "session=abc; Path=/; HttpOnly..." → "session=abc"
	const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
	return { status: response.status, data, cookie, setCookie: response.headers.get("Set-Cookie") };
}

// Signs up and returns the session cookie.
async function signUp(username = "alice", password = "password123") {
	const { status, cookie } = await call("POST", "/api/users/signup", { body: { username, password } });
	expect(status).toBe(201);
	return cookie!;
}

async function addItem(cookie: string, name: string, type = "Top") {
	const { status, data } = await call("POST", "/api/items", { cookie, body: { name, type } });
	expect(status).toBe(201);
	return data.item!;
}

async function addOutfit(cookie: string, name: string, itemIds: string[]) {
	const { status, data } = await call("POST", "/api/outfits", { cookie, body: { name, itemIds } });
	expect(status).toBe(201);
	return data.outfit!;
}

async function addOccasion(cookie: string, name: string, outfitIds: string[]) {
	const { status, data } = await call("POST", "/api/occasions", { cookie, body: { name, outfitIds } });
	expect(status).toBe(201);
	return data.occasion!;
}

// --- Users ---

describe("sign up", () => {
	it("creates the account, logs in with an httpOnly cookie, and returns only the username", async () => {
		const { status, data, setCookie } = await call("POST", "/api/users/signup", {
			body: { username: "alice", password: "password123" },
		});
		expect(status).toBe(201);
		expect(data).toEqual({ user: { username: "alice" } });
		expect(setCookie).toMatch(/^session=/);
		expect(setCookie).toMatch(/HttpOnly/);
		expect(setCookie).toMatch(/SameSite=Lax/);
	});

	it("stores a salted PBKDF2 hash, never the password", async () => {
		await signUp("alice", "password123");
		const row = sqlite.prepare("SELECT password_hash FROM users").get() as { password_hash: string };
		expect(row.password_hash).toMatch(/^pbkdf2-sha256\$10000\$[^$]+\$[^$]+$/);
		expect(row.password_hash).not.toContain("password123");
	});

	it("gives the same password a different hash for each user", async () => {
		await signUp("alice", "password123");
		await signUp("bobby", "password123");
		const rows = sqlite.prepare("SELECT password_hash FROM users").all() as { password_hash: string }[];
		expect(rows[0].password_hash).not.toBe(rows[1].password_hash);
	});

	it.each([
		["a short username", { username: "ab", password: "password123" }, "Username must be 3–30"],
		["a username with spaces", { username: "al ice", password: "password123" }, "Username must be 3–30"],
		["a 31-character username", { username: "a".repeat(31), password: "password123" }, "Username must be 3–30"],
		["a short password", { username: "alice", password: "short" }, "at least 8 characters"],
		["a missing password", { username: "alice" }, "at least 8 characters"],
		["a 201-character password", { username: "alice", password: "p".repeat(201) }, "200 characters or fewer"],
	])("rejects %s with 400", async (_label, body, message) => {
		const { status, data } = await call("POST", "/api/users/signup", { body });
		expect(status).toBe(400);
		expect(data.error).toContain(message);
	});

	it("rejects a taken username, ignoring case, with 409", async () => {
		await signUp("alice");
		const { status, data } = await call("POST", "/api/users/signup", {
			body: { username: "ALICE", password: "password123" },
		});
		expect(status).toBe(409);
		expect(data.error).toBe("That username is taken");
	});
});

describe("log in", () => {
	beforeEach(async () => {
		await signUp("alice", "password123");
	});

	it("logs in with the right password, ignoring the username's case", async () => {
		const { status, data, cookie } = await call("POST", "/api/users/login", {
			body: { username: "Alice", password: "password123" },
		});
		expect(status).toBe(200);
		expect(data.user).toEqual({ username: "alice" });
		expect(cookie).toMatch(/^session=/);
	});

	it("gives the same 401 for a wrong password and an unknown user", async () => {
		const wrong = await call("POST", "/api/users/login", { body: { username: "alice", password: "wrongpass" } });
		const unknown = await call("POST", "/api/users/login", { body: { username: "nobody", password: "password123" } });
		expect(wrong.status).toBe(401);
		expect(unknown.status).toBe(401);
		expect(wrong.data.error).toBe("Incorrect username or password");
		expect(unknown.data.error).toBe(wrong.data.error);
	});

	it("rejects an over-long password without hashing it", async () => {
		const { status } = await call("POST", "/api/users/login", { body: { username: "alice", password: "p".repeat(201) } });
		expect(status).toBe(401);
	});

	it("needs both fields", async () => {
		const { status, data } = await call("POST", "/api/users/login", { body: { username: "alice" } });
		expect(status).toBe(400);
		expect(data.error).toBe("Enter your username and password");
	});
});

describe("password guessing limit", () => {
	const login = (username: string, password: string) =>
		call("POST", "/api/users/login", { body: { username, password } });
	const savedTries = () =>
		sqlite.prepare("SELECT username, attempts FROM login_attempts ORDER BY username").all();

	beforeEach(async () => {
		await signUp("alice", "password123");
	});

	it("allows 5 tries, then locks the username for 15 minutes, even with the right password", async () => {
		for (let i = 0; i < 5; i++) {
			expect((await login("alice", "wrongpass")).status).toBe(401);
		}
		const locked = await login("alice", "password123");
		expect(locked.status).toBe(429);
		expect(locked.data.error).toBe("Too many failed login attempts. Try again in 15 minutes.");
		expect(locked.cookie).toBeUndefined();
	});

	it("counts the username no matter its case", async () => {
		for (const name of ["alice", "ALICE", "Alice", "aLiCe", "alicE"]) {
			await login(name, "wrongpass");
		}
		expect((await login("alice", "password123")).status).toBe(429);
		expect(savedTries()).toEqual([{ username: "alice", attempts: 6 }]);
	});

	it("doesn't lock anyone else", async () => {
		await signUp("bobby", "password123");
		for (let i = 0; i < 6; i++) {
			await login("alice", "wrongpass");
		}
		expect((await login("bobby", "password123")).status).toBe(200);
	});

	it("unlocks once the 15 minutes are up", async () => {
		for (let i = 0; i < 6; i++) {
			await login("alice", "wrongpass");
		}
		sqlite.exec("UPDATE login_attempts SET window_start = window_start - 15 * 60");
		expect((await login("alice", "password123")).status).toBe(200);
	});

	it("says 1 minute when less than a minute is left", async () => {
		for (let i = 0; i < 5; i++) {
			await login("alice", "wrongpass");
		}
		sqlite.exec("UPDATE login_attempts SET window_start = unixepoch() - 15 * 60 + 30");
		expect((await login("alice", "password123")).data.error).toBe(
			"Too many failed login attempts. Try again in 1 minute.",
		);
	});

	it("a successful log in resets the count", async () => {
		for (let i = 0; i < 4; i++) {
			await login("alice", "wrongpass");
		}
		expect((await login("alice", "password123")).status).toBe(200);
		expect(savedTries()).toEqual([]);
		// Without the reset, this would be try 10 and locked.
		for (let i = 0; i < 4; i++) {
			await login("alice", "wrongpass");
		}
		expect((await login("alice", "password123")).status).toBe(200);
	});

	it("limits usernames that don't exist too, but doesn't save impossible ones", async () => {
		for (let i = 0; i < 5; i++) {
			expect((await login("ghost", "wrongpass")).status).toBe(401);
		}
		expect((await login("ghost", "wrongpass")).status).toBe(429);
		expect((await login("x".repeat(31), "wrongpass")).status).toBe(401);
		expect(savedTries()).toEqual([{ username: "ghost", attempts: 6 }]);
	});

	it("counts over-long passwords as tries", async () => {
		for (let i = 0; i < 5; i++) {
			await login("alice", "p".repeat(201));
		}
		expect((await login("alice", "password123")).status).toBe(429);
	});

	it("deletes expired tries so the table doesn't keep growing", async () => {
		await login("ghost1", "wrongpass");
		await login("ghost2", "wrongpass");
		sqlite.exec("UPDATE login_attempts SET window_start = window_start - 15 * 60");
		await login("ghost3", "wrongpass");
		expect(savedTries()).toEqual([{ username: "ghost3", attempts: 1 }]);
	});
});

describe("sessions", () => {
	it("/me returns the user for a valid cookie and 401 without one", async () => {
		const cookie = await signUp("alice");
		expect((await call("GET", "/api/users/me", { cookie })).data.user).toEqual({ username: "alice" });
		expect((await call("GET", "/api/users/me")).status).toBe(401);
		expect((await call("GET", "/api/users/me", { cookie: "session=made-up" })).status).toBe(401);
	});

	it("log out ends the session on the server, so the old cookie stops working", async () => {
		const cookie = await signUp("alice");
		const { status, setCookie } = await call("POST", "/api/users/logout", { cookie });
		expect(status).toBe(200);
		expect(setCookie).toMatch(/Max-Age=0/);
		expect((await call("GET", "/api/users/me", { cookie })).status).toBe(401);
	});

	it("an expired session is rejected", async () => {
		const cookie = await signUp("alice");
		sqlite.exec("UPDATE sessions SET expires_at = unixepoch() - 1");
		expect((await call("GET", "/api/users/me", { cookie })).status).toBe(401);
	});

	it("stores only a hash of the session token", async () => {
		const cookie = await signUp("alice");
		const token = decodeURIComponent(cookie.replace("session=", ""));
		const row = sqlite.prepare("SELECT id FROM sessions").get() as { id: string };
		expect(row.id).not.toBe(token);
	});

	it("logging in again clears out the user's expired sessions", async () => {
		await signUp("alice");
		sqlite.exec("UPDATE sessions SET expires_at = unixepoch() - 1");
		await call("POST", "/api/users/login", { body: { username: "alice", password: "password123" } });
		const { count } = sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
		expect(count).toBe(1);
	});
});

// --- Items ---

describe("items", () => {
	it.each([
		["GET", "/api/items"],
		["POST", "/api/items"],
		["GET", "/api/outfits"],
		["GET", "/api/occasions"],
	])("%s %s needs you to be logged in", async (method, path) => {
		expect((await call(method, path)).status).toBe(401);
	});

	it("adds items and lists them oldest first", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "  White shirt  ", "Top");
		await addItem(cookie, "Blue jeans", "Bottom");
		expect(shirt).toEqual({ id: expect.any(String), name: "White shirt", type: "Top", compatibleIds: [] });
		const { data } = await call("GET", "/api/items", { cookie });
		expect(data.items!.map((item) => item.name)).toEqual(["White shirt", "Blue jeans"]);
	});

	it.each([
		["a blank name", { name: "   ", type: "Top" }, "name is required"],
		["a 101-character name", { name: "x".repeat(101), type: "Top" }, "100 characters or fewer"],
		["an unknown type", { name: "Hat", type: "Hat" }, "type must be one of"],
	])("rejects %s with 400", async (_label, body, message) => {
		const cookie = await signUp();
		const { status, data } = await call("POST", "/api/items", { cookie, body });
		expect(status).toBe(400);
		expect(data.error).toContain(message);
	});

	it("rejects a body that isn't a JSON object", async () => {
		const cookie = await signUp();
		for (const rawBody of ["not json", "[1,2]", "null"]) {
			const { status, data } = await call("POST", "/api/items", { cookie, rawBody });
			expect(status).toBe(400);
			expect(data.error).toBe("Body must be a JSON object");
		}
	});

	it("gets one item by id, and 404s for one that doesn't exist", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		expect((await call("GET", `/api/items/${shirt.id}`, { cookie })).data.item).toEqual(shirt);
		expect((await call("GET", "/api/items/nope", { cookie })).status).toBe(404);
	});

	it("only shows each user their own items", async () => {
		const alice = await signUp("alice");
		const shirt = await addItem(alice, "White shirt");
		const bobby = await signUp("bobby");
		expect((await call("GET", "/api/items", { cookie: bobby })).data.items).toEqual([]);
		expect((await call("GET", `/api/items/${shirt.id}`, { cookie: bobby })).status).toBe(404);
		expect((await call("DELETE", `/api/items/${shirt.id}`, { cookie: bobby })).status).toBe(404);
		expect((await call("GET", `/api/items/${shirt.id}`, { cookie: alice })).status).toBe(200);
	});

	it("deletes an item, and 404s the second time", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		expect((await call("DELETE", `/api/items/${shirt.id}`, { cookie })).status).toBe(200);
		expect((await call("DELETE", `/api/items/${shirt.id}`, { cookie })).status).toBe(404);
	});
});

describe("compatibility", () => {
	it("marks two items as going together, both ways, without duplicates", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		const jeans = await addItem(cookie, "Blue jeans", "Bottom");

		const first = await call("PUT", `/api/items/${shirt.id}/compatible/${jeans.id}`, { cookie });
		expect(first.data.item!.compatibleIds).toEqual([jeans.id]);
		const again = await call("PUT", `/api/items/${shirt.id}/compatible/${jeans.id}`, { cookie });
		expect(again.data.item!.compatibleIds).toEqual([jeans.id]);

		const { data } = await call("GET", `/api/items/${jeans.id}`, { cookie });
		expect(data.item!.compatibleIds).toEqual([shirt.id]);
	});

	it("unmarks them from either side", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		const jeans = await addItem(cookie, "Blue jeans", "Bottom");
		await call("PUT", `/api/items/${shirt.id}/compatible/${jeans.id}`, { cookie });

		const { data } = await call("DELETE", `/api/items/${jeans.id}/compatible/${shirt.id}`, { cookie });
		expect(data.item!.compatibleIds).toEqual([]);
		const shirtNow = await call("GET", `/api/items/${shirt.id}`, { cookie });
		expect(shirtNow.data.item!.compatibleIds).toEqual([]);
	});

	it("won't match an item with itself, a missing item, or someone else's item", async () => {
		const alice = await signUp("alice");
		const shirt = await addItem(alice, "White shirt");
		const bobby = await signUp("bobby");
		const bobbysHat = await addItem(bobby, "Hat", "Accessory");

		const self = await call("PUT", `/api/items/${shirt.id}/compatible/${shirt.id}`, { cookie: alice });
		expect(self.status).toBe(400);
		expect((await call("PUT", `/api/items/${shirt.id}/compatible/nope`, { cookie: alice })).status).toBe(404);
		expect((await call("PUT", `/api/items/${shirt.id}/compatible/${bobbysHat.id}`, { cookie: alice })).status).toBe(404);
	});
});

// --- Outfits and occasions ---

describe("outfits", () => {
	it("saves an outfit with its items in the order they were picked", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		const jeans = await addItem(cookie, "Blue jeans", "Bottom");
		const outfit = await addOutfit(cookie, "Brunch", [jeans.id, shirt.id, jeans.id]);
		expect(outfit.itemIds).toEqual([jeans.id, shirt.id]);
		expect((await call("GET", "/api/outfits", { cookie })).data.outfits).toEqual([outfit]);
		expect((await call("GET", `/api/outfits/${outfit.id}`, { cookie })).data.outfit).toEqual(outfit);
		expect((await call("GET", "/api/outfits/nope", { cookie })).status).toBe(404);
	});

	it.each([
		["no items", { name: "Empty", itemIds: [] }, "at least one id"],
		["items that aren't a list", { name: "Odd", itemIds: "abc" }, "at least one id"],
		["ids that aren't strings", { name: "Odd", itemIds: [1, 2] }, "must only contain ids"],
		["more than 50 items", { name: "Huge", itemIds: Array.from({ length: 51 }, (_, i) => `id${i}`) }, "at most 50"],
		["an item that doesn't exist", { name: "Ghost", itemIds: ["nope"] }, "doesn't exist"],
	])("rejects %s with 400", async (_label, body, message) => {
		const cookie = await signUp();
		const { status, data } = await call("POST", "/api/outfits", { cookie, body });
		expect(status).toBe(400);
		expect(data.error).toContain(message);
	});

	it("won't use another user's item", async () => {
		const alice = await signUp("alice");
		const shirt = await addItem(alice, "White shirt");
		const bobby = await signUp("bobby");
		const { status } = await call("POST", "/api/outfits", { cookie: bobby, body: { name: "Mine", itemIds: [shirt.id] } });
		expect(status).toBe(400);
	});
});

describe("occasions", () => {
	it("saves an occasion with its outfits", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		const brunch = await addOutfit(cookie, "Brunch", [shirt.id]);
		const weekend = await addOccasion(cookie, "Weekend", [brunch.id]);
		expect(weekend).toEqual({ id: expect.any(String), name: "Weekend", outfitIds: [brunch.id] });
		expect((await call("GET", "/api/occasions", { cookie })).data.occasions).toEqual([weekend]);
		expect((await call("GET", `/api/occasions/${weekend.id}`, { cookie })).data.occasion).toEqual(weekend);
		expect((await call("GET", "/api/occasions/nope", { cookie })).status).toBe(404);
	});

	it("won't use an outfit that doesn't exist", async () => {
		const cookie = await signUp();
		const { status, data } = await call("POST", "/api/occasions", { cookie, body: { name: "Party", outfitIds: ["nope"] } });
		expect(status).toBe(400);
		expect(data.error).toContain("doesn't exist");
	});

	it("deletes an occasion but keeps its outfits", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		const brunch = await addOutfit(cookie, "Brunch", [shirt.id]);
		const weekend = await addOccasion(cookie, "Weekend", [brunch.id]);
		expect((await call("DELETE", `/api/occasions/${weekend.id}`, { cookie })).status).toBe(200);
		expect((await call("DELETE", `/api/occasions/${weekend.id}`, { cookie })).status).toBe(404);
		expect((await call("GET", "/api/outfits", { cookie })).data.outfits).toEqual([brunch]);
	});
});

// --- What deleting cleans up ---

describe("deleting cleans up after itself", () => {
	it("deleting an item removes it from compatibility and outfits, and deletes outfits and occasions left empty", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		const jeans = await addItem(cookie, "Blue jeans", "Bottom");
		const shoes = await addItem(cookie, "Loafers", "Shoes");
		await call("PUT", `/api/items/${shirt.id}/compatible/${shoes.id}`, { cookie });
		const brunch = await addOutfit(cookie, "Brunch", [shirt.id, jeans.id]);
		const shoesOnly = await addOutfit(cookie, "Shoes only", [shoes.id]);
		const weekend = await addOccasion(cookie, "Weekend", [brunch.id, shoesOnly.id]);
		await addOccasion(cookie, "Errands", [shoesOnly.id]);

		await call("DELETE", `/api/items/${shoes.id}`, { cookie });

		const items = (await call("GET", "/api/items", { cookie })).data.items!;
		expect(items.find((item) => item.id === shirt.id)!.compatibleIds).toEqual([]);
		// "Shoes only" had nothing left, so it's gone; "Brunch" didn't use the shoes.
		expect((await call("GET", "/api/outfits", { cookie })).data.outfits).toEqual([brunch]);
		// "Errands" only had "Shoes only", so it's gone too; "Weekend" keeps "Brunch".
		expect((await call("GET", "/api/occasions", { cookie })).data.occasions).toEqual([
			{ ...weekend, outfitIds: [brunch.id] },
		]);
	});

	it("deleting an outfit removes it from occasions, and deletes occasions left empty", async () => {
		const cookie = await signUp();
		const shirt = await addItem(cookie, "White shirt");
		const brunch = await addOutfit(cookie, "Brunch", [shirt.id]);
		await addOccasion(cookie, "Weekend", [brunch.id]);

		expect((await call("DELETE", `/api/outfits/${brunch.id}`, { cookie })).status).toBe(200);
		expect((await call("DELETE", `/api/outfits/${brunch.id}`, { cookie })).status).toBe(404);
		expect((await call("GET", "/api/occasions", { cookie })).data.occasions).toEqual([]);
		// The item itself stays.
		expect((await call("GET", "/api/items", { cookie })).data.items).toHaveLength(1);
	});

	it("only cleans up the user's own outfits", async () => {
		const alice = await signUp("alice");
		const aliceShirt = await addItem(alice, "White shirt");
		const bobby = await signUp("bobby");
		const bobbyHat = await addItem(bobby, "Hat", "Accessory");
		const bobbyOutfit = await addOutfit(bobby, "Hat day", [bobbyHat.id]);

		await call("DELETE", `/api/items/${aliceShirt.id}`, { cookie: alice });
		expect((await call("GET", "/api/outfits", { cookie: bobby })).data.outfits).toEqual([bobbyOutfit]);
	});
});

describe("HTTPS", () => {
	const send = (url: string, init: RequestInit = {}) => app.request(url, { redirect: "manual", ...init }, env);

	it("redirects plain HTTP to HTTPS, keeping the path and query", async () => {
		const response = await send("http://fashionapp.example.workers.dev/api/items?x=1");
		expect(response.status).toBe(308);
		expect(response.headers.get("Location")).toBe("https://fashionapp.example.workers.dev/api/items?x=1");
	});

	it("uses 308 so a POST stays a POST, and doesn't run the route over HTTP", async () => {
		const response = await send("http://fashionapp.example.workers.dev/api/users/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "alice", password: "password123" }),
		});
		expect(response.status).toBe(308);
		expect(sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
	});

	it("tells browsers to stay on HTTPS (HSTS), including on errors", async () => {
		for (const path of ["/api/users/me", "/api/nope"]) {
			const response = await send(`https://fashionapp.example.workers.dev${path}`);
			expect(response.status).not.toBe(308);
			expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
		}
	});

	it.each(["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"])(
		"doesn't redirect local development at %s",
		async (origin) => {
			expect((await send(`${origin}/api/users/me`)).status).toBe(401);
		},
	);

	it("the app's pages and files get the HSTS header too (public/_headers)", () => {
		const headers = readFileSync(join(__dirname, "../../public/_headers"), "utf8");
		expect(headers).toMatch(/^\/\*\n\s+Strict-Transport-Security: max-age=31536000\n/);
	});
});

describe("anything else", () => {
	it("unknown routes get a JSON 404", async () => {
		const { status, data } = await call("GET", "/api/nope");
		expect(status).toBe(404);
		expect(data.error).toBe("Not found");
	});

	it("unexpected errors become a JSON 500 without the details", async () => {
		const cookie = await signUp();
		sqlite.exec("DROP TABLE outfit_items");
		const { status, data } = await call("GET", "/api/outfits", { cookie });
		expect(status).toBe(500);
		expect(data.error).toBe("Internal server error");
	});
});

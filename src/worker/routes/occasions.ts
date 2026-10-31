import { Hono } from "hono";
import type { Occasion } from "../../shared/types";
import { requireUser, type AppEnv } from "../auth";
import { groupIds, MAX_ORDER_IDS, saveOrder, type LinkRow } from "../db";
import { badRequest, readIds, readJsonObject, readName } from "../http";

// Every route only sees the logged-in user's own occasions; anyone else's are 404.
export const occasions = new Hono<AppEnv>();

occasions.use(requireUser);

// The user's occasions in the order they put them in (oldest first until they move one),
// each with its outfit ids. Pass an id to load just that occasion.
async function loadOccasions(db: D1Database, userId: string, id: string | null = null): Promise<Occasion[]> {
	const [occasionRows, linkRows] = await db.batch([
		db
			.prepare("SELECT id, name FROM occasions WHERE user_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY position, rowid")
			.bind(userId, id),
		db
			.prepare(
				`SELECT occasion_outfits.occasion_id AS parent_id, occasion_outfits.outfit_id AS child_id
				FROM occasion_outfits JOIN occasions ON occasions.id = occasion_outfits.occasion_id
				WHERE occasions.user_id = ?1 AND (?2 IS NULL OR occasions.id = ?2)
				ORDER BY occasion_outfits.rowid`,
			)
			.bind(userId, id),
	]);
	const outfitIds = groupIds(linkRows.results as LinkRow[]);
	return (occasionRows.results as { id: string; name: string }[]).map((row) => ({
		...row,
		outfitIds: outfitIds.get(row.id) ?? [],
	}));
}

// Reads { name, outfitIds } and checks every outfit is one of the user's. Otherwise throws 400.
async function readOccasion(db: D1Database, userId: string, body: Record<string, unknown>) {
	const name = readName(body.name, "name");
	const outfitIds = readIds(body.outfitIds, "outfitIds");
	const placeholders = outfitIds.map(() => "?").join(", ");
	const owned = await db
		.prepare(`SELECT COUNT(*) AS count FROM outfits WHERE user_id = ? AND id IN (${placeholders})`)
		.bind(userId, ...outfitIds)
		.first<number>("count");
	if (owned !== outfitIds.length) {
		throw badRequest("outfitIds has an outfit that doesn't exist");
	}
	return { name, outfitIds };
}

// The statements that save an occasion's outfits, in the order given.
function insertOutfits(db: D1Database, occasionId: string, outfitIds: string[]) {
	return outfitIds.map((outfitId) =>
		db.prepare("INSERT INTO occasion_outfits (occasion_id, outfit_id) VALUES (?, ?)").bind(occasionId, outfitId),
	);
}

// GET /api/occasions → 200 { occasions }
occasions.get("/", async (c) => {
	return c.json({ occasions: await loadOccasions(c.env.DB, c.var.user.id) });
});

// POST /api/occasions  { name, outfitIds } → 201 { occasion } | 400.
// Needs at least one outfit, and every outfit must be one of the user's. New occasions go at the end of the list.
occasions.post("/", async (c) => {
	const db = c.env.DB;
	const { name, outfitIds } = await readOccasion(db, c.var.user.id, await readJsonObject(c));

	// One batch, so the occasion and its outfits are saved together or not at all.
	const occasion: Occasion = { id: crypto.randomUUID(), name, outfitIds };
	await db.batch([
		db
			.prepare(
				`INSERT INTO occasions (id, user_id, name, position)
				VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position), -1) + 1 FROM occasions WHERE user_id = ?2))`,
			)
			.bind(occasion.id, c.var.user.id, name),
		...insertOutfits(db, occasion.id, outfitIds),
	]);
	return c.json({ occasion }, 201);
});

// PUT /api/occasions/order  { ids } → 200 | 400. Saves the order the user put their occasions in.
// Registered before /:id so "order" isn't read as an id.
occasions.put("/order", async (c) => {
	const body = await readJsonObject(c);
	await saveOrder(c.env.DB, "occasions", c.var.user.id, readIds(body.ids, "ids", MAX_ORDER_IDS));
	return c.json({ ok: true });
});

// GET /api/occasions/:id → 200 { occasion } | 404
occasions.get("/:id", async (c) => {
	const [occasion] = await loadOccasions(c.env.DB, c.var.user.id, c.req.param("id"));
	if (!occasion) {
		return c.json({ error: "Occasion not found" }, 404);
	}
	return c.json({ occasion });
});

// PUT /api/occasions/:id  { name, outfitIds } → 200 { occasion } | 400 | 404.
// Renames the occasion and replaces its outfits, with the same rules as saving a new one.
occasions.put("/:id", async (c) => {
	const db = c.env.DB;
	const id = c.req.param("id");
	const body = await readJsonObject(c);
	const exists = await db
		.prepare("SELECT 1 FROM occasions WHERE id = ? AND user_id = ?")
		.bind(id, c.var.user.id)
		.first();
	if (!exists) {
		return c.json({ error: "Occasion not found" }, 404);
	}
	const { name, outfitIds } = await readOccasion(db, c.var.user.id, body);

	// One batch, so the new name and outfits are saved together or not at all.
	await db.batch([
		db.prepare("UPDATE occasions SET name = ? WHERE id = ? AND user_id = ?").bind(name, id, c.var.user.id),
		db.prepare("DELETE FROM occasion_outfits WHERE occasion_id = ?").bind(id),
		...insertOutfits(db, id, outfitIds),
	]);
	const occasion: Occasion = { id, name, outfitIds };
	return c.json({ occasion });
});

// DELETE /api/occasions/:id → 200 | 404. Its links to outfits go with it (ON DELETE CASCADE).
occasions.delete("/:id", async (c) => {
	const result = await c.env.DB.prepare("DELETE FROM occasions WHERE id = ? AND user_id = ?")
		.bind(c.req.param("id"), c.var.user.id)
		.run();
	if (result.meta.changes === 0) {
		return c.json({ error: "Occasion not found" }, 404);
	}
	return c.json({ ok: true });
});

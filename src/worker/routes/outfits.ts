import { Hono } from "hono";
import type { Outfit } from "../../shared/types";
import { requireUser, type AppEnv } from "../auth";
import { deleteEmptyGroups, groupIds, type LinkRow } from "../db";
import { badRequest, readIds, readJsonObject, readName } from "../http";

// Every route only sees the logged-in user's own outfits; anyone else's are 404.
export const outfits = new Hono<AppEnv>();

outfits.use(requireUser);

// The user's outfits, oldest first, each with its item ids. Pass an id to load just that outfit.
async function loadOutfits(db: D1Database, userId: string, id: string | null = null): Promise<Outfit[]> {
	const [outfitRows, linkRows] = await db.batch([
		db
			.prepare("SELECT id, name FROM outfits WHERE user_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY rowid")
			.bind(userId, id),
		db
			.prepare(
				`SELECT outfit_items.outfit_id AS parent_id, outfit_items.item_id AS child_id
				FROM outfit_items JOIN outfits ON outfits.id = outfit_items.outfit_id
				WHERE outfits.user_id = ?1 AND (?2 IS NULL OR outfits.id = ?2)
				ORDER BY outfit_items.rowid`,
			)
			.bind(userId, id),
	]);
	const itemIds = groupIds(linkRows.results as LinkRow[]);
	return (outfitRows.results as { id: string; name: string }[]).map((row) => ({
		...row,
		itemIds: itemIds.get(row.id) ?? [],
	}));
}

// GET /api/outfits → 200 { outfits }
outfits.get("/", async (c) => {
	return c.json({ outfits: await loadOutfits(c.env.DB, c.var.user.id) });
});

// POST /api/outfits  { name, itemIds } → 201 { outfit } | 400.
// Needs at least one item, and every item must be one of the user's.
outfits.post("/", async (c) => {
	const db = c.env.DB;
	const body = await readJsonObject(c);
	const name = readName(body.name, "name");
	const itemIds = readIds(body.itemIds, "itemIds");

	const placeholders = itemIds.map(() => "?").join(", ");
	const owned = await db
		.prepare(`SELECT COUNT(*) AS count FROM items WHERE user_id = ? AND id IN (${placeholders})`)
		.bind(c.var.user.id, ...itemIds)
		.first<number>("count");
	if (owned !== itemIds.length) {
		throw badRequest("itemIds has an item that doesn't exist");
	}

	// One batch, so the outfit and its items are saved together or not at all.
	const outfit: Outfit = { id: crypto.randomUUID(), name, itemIds };
	await db.batch([
		db.prepare("INSERT INTO outfits (id, user_id, name) VALUES (?, ?, ?)").bind(outfit.id, c.var.user.id, name),
		...itemIds.map((itemId) =>
			db.prepare("INSERT INTO outfit_items (outfit_id, item_id) VALUES (?, ?)").bind(outfit.id, itemId),
		),
	]);
	return c.json({ outfit }, 201);
});

// GET /api/outfits/:id → 200 { outfit } | 404
outfits.get("/:id", async (c) => {
	const [outfit] = await loadOutfits(c.env.DB, c.var.user.id, c.req.param("id"));
	if (!outfit) {
		return c.json({ error: "Outfit not found" }, 404);
	}
	return c.json({ outfit });
});

// DELETE /api/outfits/:id → 200 | 404.
// The database also removes it from occasions (ON DELETE CASCADE); occasions left empty are deleted too.
outfits.delete("/:id", async (c) => {
	const db = c.env.DB;
	const [deleted] = await db.batch([
		db.prepare("DELETE FROM outfits WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.var.user.id),
		...deleteEmptyGroups(db, c.var.user.id),
	]);
	if (deleted.meta.changes === 0) {
		return c.json({ error: "Outfit not found" }, 404);
	}
	return c.json({ ok: true });
});

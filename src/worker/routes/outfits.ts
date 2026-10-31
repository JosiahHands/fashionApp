import { Hono } from "hono";
import type { Outfit } from "../../shared/types";
import { requireUser, type AppEnv } from "../auth";
import { deleteEmptyGroups, groupIds, MAX_ORDER_IDS, saveOrder, type LinkRow } from "../db";
import { badRequest, readIds, readJsonObject, readName } from "../http";

// Every route only sees the logged-in user's own outfits; anyone else's are 404.
export const outfits = new Hono<AppEnv>();

outfits.use(requireUser);

// The user's outfits in the order they put them in (oldest first until they move one),
// each with its item ids. Pass an id to load just that outfit.
async function loadOutfits(db: D1Database, userId: string, id: string | null = null): Promise<Outfit[]> {
	const [outfitRows, linkRows] = await db.batch([
		db
			.prepare("SELECT id, name FROM outfits WHERE user_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY position, rowid")
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

// Reads { name, itemIds } and checks every item is one of the user's. Otherwise throws 400.
async function readOutfit(db: D1Database, userId: string, body: Record<string, unknown>) {
	const name = readName(body.name, "name");
	const itemIds = readIds(body.itemIds, "itemIds");
	const placeholders = itemIds.map(() => "?").join(", ");
	const owned = await db
		.prepare(`SELECT COUNT(*) AS count FROM items WHERE user_id = ? AND id IN (${placeholders})`)
		.bind(userId, ...itemIds)
		.first<number>("count");
	if (owned !== itemIds.length) {
		throw badRequest("itemIds has an item that doesn't exist");
	}
	return { name, itemIds };
}

// The statements that save an outfit's items, in the order given.
function insertItems(db: D1Database, outfitId: string, itemIds: string[]) {
	return itemIds.map((itemId) =>
		db.prepare("INSERT INTO outfit_items (outfit_id, item_id) VALUES (?, ?)").bind(outfitId, itemId),
	);
}

// GET /api/outfits → 200 { outfits }
outfits.get("/", async (c) => {
	return c.json({ outfits: await loadOutfits(c.env.DB, c.var.user.id) });
});

// POST /api/outfits  { name, itemIds } → 201 { outfit } | 400.
// Needs at least one item, and every item must be one of the user's. New outfits go at the end of the list.
outfits.post("/", async (c) => {
	const db = c.env.DB;
	const { name, itemIds } = await readOutfit(db, c.var.user.id, await readJsonObject(c));

	// One batch, so the outfit and its items are saved together or not at all.
	const outfit: Outfit = { id: crypto.randomUUID(), name, itemIds };
	await db.batch([
		db
			.prepare(
				`INSERT INTO outfits (id, user_id, name, position)
				VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position), -1) + 1 FROM outfits WHERE user_id = ?2))`,
			)
			.bind(outfit.id, c.var.user.id, name),
		...insertItems(db, outfit.id, itemIds),
	]);
	return c.json({ outfit }, 201);
});

// PUT /api/outfits/order  { ids } → 200 | 400. Saves the order the user put their outfits in.
// Registered before /:id so "order" isn't read as an id.
outfits.put("/order", async (c) => {
	const body = await readJsonObject(c);
	await saveOrder(c.env.DB, "outfits", c.var.user.id, readIds(body.ids, "ids", MAX_ORDER_IDS));
	return c.json({ ok: true });
});

// GET /api/outfits/:id → 200 { outfit } | 404
outfits.get("/:id", async (c) => {
	const [outfit] = await loadOutfits(c.env.DB, c.var.user.id, c.req.param("id"));
	if (!outfit) {
		return c.json({ error: "Outfit not found" }, 404);
	}
	return c.json({ outfit });
});

// PUT /api/outfits/:id  { name, itemIds } → 200 { outfit } | 400 | 404.
// Renames the outfit and replaces its items, with the same rules as saving a new one.
outfits.put("/:id", async (c) => {
	const db = c.env.DB;
	const id = c.req.param("id");
	const body = await readJsonObject(c);
	const exists = await db.prepare("SELECT 1 FROM outfits WHERE id = ? AND user_id = ?").bind(id, c.var.user.id).first();
	if (!exists) {
		return c.json({ error: "Outfit not found" }, 404);
	}
	const { name, itemIds } = await readOutfit(db, c.var.user.id, body);

	// One batch, so the new name and items are saved together or not at all.
	await db.batch([
		db.prepare("UPDATE outfits SET name = ? WHERE id = ? AND user_id = ?").bind(name, id, c.var.user.id),
		db.prepare("DELETE FROM outfit_items WHERE outfit_id = ?").bind(id),
		...insertItems(db, id, itemIds),
	]);
	const outfit: Outfit = { id, name, itemIds };
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

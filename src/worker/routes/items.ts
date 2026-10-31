import { Hono } from "hono";
import { itemTypes, type Item, type ItemType } from "../../shared/types";
import { requireUser, type AppEnv } from "../auth";
import { deleteEmptyGroups, groupIds, MAX_ORDER_IDS, saveOrder, type LinkRow } from "../db";
import { badRequest, readIds, readJsonObject, readName } from "../http";

// Every route only sees the logged-in user's own items; anyone else's are 404.
export const items = new Hono<AppEnv>();

items.use(requireUser);

type ItemRow = {
	id: string;
	name: string;
	type: ItemType;
};

function readType(value: unknown): ItemType {
	if (!itemTypes.includes(value as ItemType)) {
		throw badRequest(`type must be one of: ${itemTypes.join(", ")}`);
	}
	return value as ItemType;
}

// The user's items in the order they put them in (oldest first until they move one),
// each with the ids of the items it goes with.
// Pass an id to load just that one item.
async function loadItems(db: D1Database, userId: string, id: string | null = null): Promise<Item[]> {
	const [itemRows, linkRows] = await db.batch([
		db
			.prepare("SELECT id, name, type FROM items WHERE user_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY position, rowid")
			.bind(userId, id),
		db
			.prepare(
				`SELECT item_compatibility.item_id AS parent_id, item_compatibility.other_item_id AS child_id
				FROM item_compatibility JOIN items ON items.id = item_compatibility.item_id
				WHERE items.user_id = ?1 AND (?2 IS NULL OR items.id = ?2)
				ORDER BY item_compatibility.rowid`,
			)
			.bind(userId, id),
	]);
	const compatible = groupIds(linkRows.results as LinkRow[]);
	return (itemRows.results as ItemRow[]).map((row) => ({
		...row,
		compatibleIds: compatible.get(row.id) ?? [],
	}));
}

// GET /api/items → 200 { items }
items.get("/", async (c) => {
	return c.json({ items: await loadItems(c.env.DB, c.var.user.id) });
});

// POST /api/items  { name, type } → 201 { item } | 400. New items go at the end of the list.
items.post("/", async (c) => {
	const body = await readJsonObject(c);
	const name = readName(body.name, "name");
	const type = readType(body.type);
	const row = await c.env.DB.prepare(
		`INSERT INTO items (id, user_id, name, type, position)
		VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(position), -1) + 1 FROM items WHERE user_id = ?2))
		RETURNING id, name, type`,
	)
		.bind(crypto.randomUUID(), c.var.user.id, name, type)
		.first<ItemRow>();
	if (!row) {
		throw new Error("Insert returned no row");
	}
	const item: Item = { ...row, compatibleIds: [] };
	return c.json({ item }, 201);
});

// PUT /api/items/order  { ids } → 200 | 400. Saves the order the user put their items in.
// Registered before /:id routes so "order" isn't read as an id.
items.put("/order", async (c) => {
	const body = await readJsonObject(c);
	await saveOrder(c.env.DB, "items", c.var.user.id, readIds(body.ids, "ids", MAX_ORDER_IDS));
	return c.json({ ok: true });
});

// GET /api/items/:id → 200 { item } | 404
items.get("/:id", async (c) => {
	const [item] = await loadItems(c.env.DB, c.var.user.id, c.req.param("id"));
	if (!item) {
		return c.json({ error: "Item not found" }, 404);
	}
	return c.json({ item });
});

// DELETE /api/items/:id → 200 | 404.
// The database also removes it from compatibility and outfits (ON DELETE CASCADE);
// outfits left empty, and then occasions left empty, are deleted too.
items.delete("/:id", async (c) => {
	const db = c.env.DB;
	const [deleted] = await db.batch([
		db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.var.user.id),
		...deleteEmptyGroups(db, c.var.user.id),
	]);
	if (deleted.meta.changes === 0) {
		return c.json({ error: "Item not found" }, 404);
	}
	return c.json({ ok: true });
});

// PUT /api/items/:id/compatible/:otherId → 200 { item } | 400 | 404. Marks two items as going together.
// DELETE /api/items/:id/compatible/:otherId → 200 { item } | 400 | 404. Unmarks them.
// Compatibility goes both ways, so both directions are saved. Returns the first item.
items.on(["PUT", "DELETE"], "/:id/compatible/:otherId", async (c) => {
	const db = c.env.DB;
	const { id, otherId } = c.req.param();
	if (id === otherId) {
		throw badRequest("An item can't be compatible with itself");
	}
	const owned = await db
		.prepare("SELECT COUNT(*) AS count FROM items WHERE user_id = ? AND id IN (?, ?)")
		.bind(c.var.user.id, id, otherId)
		.first<number>("count");
	if (owned !== 2) {
		return c.json({ error: "Item not found" }, 404);
	}

	if (c.req.method === "PUT") {
		// OR IGNORE: marking a pair that's already marked changes nothing.
		await db.batch([
			db.prepare("INSERT OR IGNORE INTO item_compatibility (item_id, other_item_id) VALUES (?, ?)").bind(id, otherId),
			db.prepare("INSERT OR IGNORE INTO item_compatibility (item_id, other_item_id) VALUES (?, ?)").bind(otherId, id),
		]);
	} else {
		await db
			.prepare(
				`DELETE FROM item_compatibility
				WHERE (item_id = ?1 AND other_item_id = ?2) OR (item_id = ?2 AND other_item_id = ?1)`,
			)
			.bind(id, otherId)
			.run();
	}

	const [item] = await loadItems(db, c.var.user.id, id);
	return c.json({ item });
});

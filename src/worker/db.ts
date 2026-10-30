// Helpers for the D1 database (env.DB). The tables are made in migrations/0001_create_tables.sql.
// Times are seconds since 1970, the same as SQLite's unixepoch().

export type UserRow = {
	id: string;
	username: string;
	password_hash: string;
};

// The logged-in user, as loaded from their session. Never includes the password hash.
export type SessionUser = Omit<UserRow, "password_hash">;

// Rows from a join table, renamed to parent_id/child_id in the query, e.g. an outfit and one of its items.
export type LinkRow = {
	parent_id: string;
	child_id: string;
};

// Seconds since 1970, like SQLite's unixepoch().
export function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

// Turns join table rows into a map from each parent id to its child ids, in the order they were saved.
export function groupIds(rows: LinkRow[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const row of rows) {
		const ids = groups.get(row.parent_id) ?? [];
		ids.push(row.child_id);
		groups.set(row.parent_id, ids);
	}
	return groups;
}

// Deletes the user's outfits that have no items left, then occasions that have no outfits left.
// Put these after a delete in the same db.batch(), so it all happens as one transaction.
export function deleteEmptyGroups(db: D1Database, userId: string): D1PreparedStatement[] {
	return [
		db
			.prepare(
				"DELETE FROM outfits WHERE user_id = ? AND id NOT IN (SELECT outfit_id FROM outfit_items)",
			)
			.bind(userId),
		db
			.prepare(
				"DELETE FROM occasions WHERE user_id = ? AND id NOT IN (SELECT occasion_id FROM occasion_outfits)",
			)
			.bind(userId),
	];
}

-- Migration number: 0001 	 2026-10-30T20:57:54.156Z
-- Times are seconds since 1970 (what SQLite's unixepoch() returns).
-- Deleting a user deletes everything of theirs, through ON DELETE CASCADE.

-- Accounts. Usernames are unique no matter the case ("Jo" and "jo" clash).
CREATE TABLE users (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL UNIQUE COLLATE NOCASE,
	password_hash TEXT NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Logged-in browsers. id is the SHA-256 of the cookie's token, so the token itself is never saved.
CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);

CREATE TABLE items (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('Top', 'Bottom', 'Dress', 'Outerwear', 'Shoes', 'Accessory')),
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX items_user_id ON items (user_id);

-- Which items go together. Each pair is saved both ways (A→B and B→A),
-- so "what goes with A" only has to look at item_id.
CREATE TABLE item_compatibility (
	item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
	other_item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
	PRIMARY KEY (item_id, other_item_id),
	CHECK (item_id <> other_item_id)
);
CREATE INDEX item_compatibility_other_item_id ON item_compatibility (other_item_id);

CREATE TABLE outfits (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX outfits_user_id ON outfits (user_id);

-- The items in each outfit.
CREATE TABLE outfit_items (
	outfit_id TEXT NOT NULL REFERENCES outfits (id) ON DELETE CASCADE,
	item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
	PRIMARY KEY (outfit_id, item_id)
);
CREATE INDEX outfit_items_item_id ON outfit_items (item_id);

CREATE TABLE occasions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX occasions_user_id ON occasions (user_id);

-- The outfits in each occasion.
CREATE TABLE occasion_outfits (
	occasion_id TEXT NOT NULL REFERENCES occasions (id) ON DELETE CASCADE,
	outfit_id TEXT NOT NULL REFERENCES outfits (id) ON DELETE CASCADE,
	PRIMARY KEY (occasion_id, outfit_id)
);
CREATE INDEX occasion_outfits_outfit_id ON occasion_outfits (outfit_id);

-- Migration number: 0003
-- Lets users put their items, outfits and occasions in their own order.
-- Lists are sorted by position, then by when they were added, so existing rows (all 0) keep their order.
ALTER TABLE items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outfits ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE occasions ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

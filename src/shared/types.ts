export const itemTypes = [
	"Top",
	"Bottom",
	"Dress",
	"Outerwear",
	"Shoes",
	"Accessory",
] as const;

export type ItemType = (typeof itemTypes)[number];

// The password is never sent back from the server.
export type User = {
	username: string;
};

export type Item = {
	id: string;
	name: string;
	type: ItemType;
	// Ids of the items this one goes with. Kept in sync on both items.
	compatibleIds: string[];
};

export type Outfit = {
	id: string;
	name: string;
	itemIds: string[];
};

export type Occasion = {
	id: string;
	name: string;
	outfitIds: string[];
};

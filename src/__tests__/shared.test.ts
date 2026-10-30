// Tests for src/shared: the types and constants both the front end and the Worker use.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { itemTypes } from "../shared/types";

describe("itemTypes", () => {
	it("lists the six kinds of item, in the order the form shows them", () => {
		expect(itemTypes).toEqual(["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Accessory"]);
	});

	it("has no duplicates", () => {
		expect(new Set(itemTypes).size).toBe(itemTypes.length);
	});

	// The database has its own copy of this list in a CHECK rule, so the two must stay in step.
	it("matches the types the database allows", () => {
		const migration = readFileSync(join(__dirname, "../../migrations/0001_create_tables.sql"), "utf8");
		const check = migration.match(/type IN \(([^)]*)\)/);
		expect(check).not.toBeNull();
		const allowed = check![1].split(",").map((each) => each.trim().replace(/'/g, ""));
		expect(allowed).toEqual([...itemTypes]);
	});
});

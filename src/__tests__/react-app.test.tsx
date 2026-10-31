/**
 * @jest-environment jsdom
 */
// Tests for src/react-app: api.ts, each component on its own, then the whole App against a fake /api.

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Item, Occasion, Outfit } from "../shared/types";
import * as api from "../react-app/api";
import { Account } from "../react-app/components/Account/Account";
import App, { type DragHandleProps } from "../react-app/components/App/App";
import { Detail } from "../react-app/components/Detail/Detail";
import { Header } from "../react-app/components/Header/Header";
import { Items } from "../react-app/components/Items/Items";
import { Login } from "../react-app/components/Login/Login";
import { Occasions } from "../react-app/components/Occasions/Occasions";
import { Outfits } from "../react-app/components/Outfits/Outfits";
import { Search } from "../react-app/components/Search/Search";

// --- Test data ---

const shirt: Item = { id: "shirt", name: "White shirt", type: "Top", compatibleIds: ["jeans"] };
const jeans: Item = { id: "jeans", name: "Blue jeans", type: "Bottom", compatibleIds: ["shirt"] };
const shoes: Item = { id: "shoes", name: "Loafers", type: "Shoes", compatibleIds: [] };
const brunch: Outfit = { id: "brunch", name: "Brunch", itemIds: ["shirt", "jeans"] };
const errands: Outfit = { id: "errands", name: "Errands", itemIds: ["shoes"] };
const weekend: Occasion = { id: "weekend", name: "Weekend", outfitIds: ["brunch"] };

// --- Fake /api ---

type Handler = (body: unknown, path: string) => [status: number, data: unknown];
type ApiCall = { method: string; path: string; body: unknown };

// Replaces fetch with handlers keyed by "METHOD /path" (path without the /api prefix).
// A "*" in a key matches one part of the path: "DELETE /items/*" matches "DELETE /items/jeans".
// Unhandled routes get 404. Returns the list of calls made.
function mockApi(handlers: Record<string, Handler> = {}): ApiCall[] {
	const calls: ApiCall[] = [];
	globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		const path = String(input).replace(/^\/api/, "");
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ method, path, body });
		const key = `${method} ${path}`;
		const handler = Object.entries(handlers).find(([pattern]) =>
			new RegExp(`^${pattern.split("*").join("[^/]+")}$`).test(key),
		)?.[1];
		const [status, data] = handler ? handler(body, path) : [404, { error: "Not found" }];
		return { ok: status < 400, status, json: async () => data } as Response;
	}) as typeof fetch;
	return calls;
}

// A promise you resolve later, to hold a fake request open.
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

// Stands in for App's dragHandle in component tests. Records which cards asked for a handle.
function fakeDragHandle() {
	return jest.fn((): DragHandleProps => ({
		"data-dragging": false,
		onPointerDown: jest.fn(),
		onPointerMove: jest.fn(),
		onPointerUp: jest.fn(),
		onPointerCancel: jest.fn(),
		onKeyDown: jest.fn(),
	}));
}

beforeEach(() => {
	// jsdom doesn't do scrolling, layout or pointer capture, so those are stand-ins.
	window.scrollTo = jest.fn();
	window.scrollBy = jest.fn();
	Element.prototype.scrollIntoView = jest.fn();
	Element.prototype.setPointerCapture = jest.fn();
});

afterEach(() => {
	jest.restoreAllMocks();
});

// Components with links need a router around them.
function renderAt(ui: ReactNode, path = "/") {
	return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

// The login panel's submit button. ("Log in" is also the name of the header button and the mode toggle.)
function submitButton() {
	return screen.getByRole("region", { name: /Log in|Sign up/ }).querySelector<HTMLButtonElement>("button[type=submit]")!;
}

// --- api.ts ---

describe("api", () => {
	it("returns the JSON for a good response", async () => {
		mockApi({ "POST /items": () => [201, { item: shirt }] });
		await expect(api.createItem("White shirt", "Top")).resolves.toEqual(shirt);
	});

	it("throws the server's error message along with the status", async () => {
		mockApi({ "POST /users/signup": () => [409, { error: "That username is taken" }] });
		const err = await api.signUp("alice", "password123").catch((caught) => caught);
		expect(err).toBeInstanceOf(api.ApiError);
		expect(err.message).toBe("That username is taken");
		expect(err.status).toBe(409);
	});

	it("falls back to a general message when the server sends none", async () => {
		mockApi({ "GET /items": () => [500, {}] });
		await expect(api.loadWardrobe()).rejects.toThrow("Something went wrong. Try again.");
	});

	it("explains when the server can't be reached", async () => {
		globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
		const err = await api.logOut().catch((caught) => caught);
		expect(err.message).toBe("Can't reach the server. Check your connection and try again.");
		expect(err.status).toBe(0);
	});

	it("getCurrentUser is null when logged out, and throws errors", async () => {
		mockApi({ "GET /users/me": () => [200, { user: null }] });
		await expect(api.getCurrentUser()).resolves.toBeNull();
		mockApi({ "GET /users/me": () => [500, { error: "Internal server error" }] });
		await expect(api.getCurrentUser()).rejects.toThrow("Internal server error");
	});

	it("sends JSON bodies to the right routes", async () => {
		const calls = mockApi({
			"POST /users/login": () => [200, { user: { username: "alice" } }],
			"PUT /items/a%2Fb/compatible/c": () => [200, { item: shirt }],
			"DELETE /items/a%2Fb/compatible/c": () => [200, { item: shirt }],
			"PUT /outfits/brunch": () => [200, { outfit: brunch }],
			"PUT /occasions/weekend": () => [200, { occasion: weekend }],
			"PUT /outfits/order": () => [200, { ok: true }],
			"DELETE /users/me": () => [200, { ok: true }],
		});
		await api.logIn("alice", "password123");
		await api.setCompatible("a/b", "c", true);
		await api.setCompatible("a/b", "c", false);
		await expect(api.updateOutfit("brunch", "Brunch", ["shirt"])).resolves.toEqual(brunch);
		await expect(api.updateOccasion("weekend", "Weekend", ["brunch"])).resolves.toEqual(weekend);
		await api.saveOrder("outfits", ["errands", "brunch"]);
		await api.deleteAccount("password123");
		expect(calls).toEqual([
			{ method: "POST", path: "/users/login", body: { username: "alice", password: "password123" } },
			{ method: "PUT", path: "/items/a%2Fb/compatible/c", body: undefined },
			{ method: "DELETE", path: "/items/a%2Fb/compatible/c", body: undefined },
			{ method: "PUT", path: "/outfits/brunch", body: { name: "Brunch", itemIds: ["shirt"] } },
			{ method: "PUT", path: "/occasions/weekend", body: { name: "Weekend", outfitIds: ["brunch"] } },
			{ method: "PUT", path: "/outfits/order", body: { ids: ["errands", "brunch"] } },
			{ method: "DELETE", path: "/users/me", body: { password: "password123" } },
		]);
	});

	it("loadWardrobe gets items, outfits and occasions together", async () => {
		mockApi({
			"GET /items": () => [200, { items: [shirt] }],
			"GET /outfits": () => [200, { outfits: [brunch] }],
			"GET /occasions": () => [200, { occasions: [weekend] }],
		});
		await expect(api.loadWardrobe()).resolves.toEqual({ items: [shirt], outfits: [brunch], occasions: [weekend] });
	});
});

// --- Components ---

describe("Search", () => {
	it("shows nothing until you type", () => {
		renderAt(<Search items={[shirt, jeans]} />);
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});

	it("finds items whose name includes the search, ignoring case, and shows what they go with", async () => {
		const user = userEvent.setup();
		renderAt(<Search items={[shirt, jeans, shoes]} />);
		await user.type(screen.getByLabelText("Item name"), "SHIRT");
		const result = screen.getByRole("link", { name: "White shirt" }).closest("li")!;
		expect(within(result).getByText("Blue jeans")).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "Loafers" })).not.toBeInTheDocument();
	});

	it("says when an item isn't matched with anything, and when nothing matches", async () => {
		const user = userEvent.setup();
		renderAt(<Search items={[shoes]} />);
		await user.type(screen.getByLabelText("Item name"), "loaf");
		expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
		await user.clear(screen.getByLabelText("Item name"));
		await user.type(screen.getByLabelText("Item name"), "hat");
		expect(screen.getByText('No items match "hat".')).toBeInTheDocument();
	});
});

describe("Items", () => {
	function renderItems(
		items: Item[],
		onAdd = jest.fn().mockResolvedValue(true),
		onToggleCompatible = jest.fn().mockResolvedValue(undefined),
	) {
		const onRemove = jest.fn();
		const dragHandle = fakeDragHandle();
		renderAt(
			<Items
				items={items}
				onAdd={onAdd}
				onToggleCompatible={onToggleCompatible}
				onRemove={onRemove}
				dragHandle={dragHandle}
			/>,
		);
		return { user: userEvent.setup(), onAdd, onToggleCompatible, onRemove, dragHandle };
	}

	it("adds an item with a trimmed name, then resets the name and type", async () => {
		const { user, onAdd } = renderItems([]);
		await user.type(screen.getByLabelText("Name"), "  Rain coat ");
		await user.selectOptions(screen.getByLabelText("Type"), "Outerwear");
		await user.click(screen.getByRole("button", { name: "Add item" }));
		expect(onAdd).toHaveBeenCalledWith("Rain coat", "Outerwear");
		expect(screen.getByLabelText("Name")).toHaveValue("");
		expect(screen.getByLabelText("Type")).toHaveValue("Top");
	});

	it("can't add a name that's only spaces, or longer than 100 characters", async () => {
		const { user } = renderItems([]);
		const add = screen.getByRole("button", { name: "Add item" });
		expect(add).toBeDisabled();
		await user.type(screen.getByLabelText("Name"), "   ");
		expect(add).toBeDisabled();
		expect(screen.getByLabelText("Name")).toHaveAttribute("maxLength", "100");
	});

	it("adds only once when Add item is double-clicked", async () => {
		const saving = deferred<boolean>();
		const { user, onAdd } = renderItems([], jest.fn().mockReturnValue(saving.promise));
		await user.type(screen.getByLabelText("Name"), "Rain coat");
		await user.dblClick(screen.getByRole("button", { name: "Add item" }));
		expect(onAdd).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
		saving.resolve(true);
		expect(await screen.findByRole("button", { name: "Add item" })).toBeInTheDocument();
	});

	it("keeps what was typed if saving fails", async () => {
		const { user } = renderItems([], jest.fn().mockResolvedValue(false));
		await user.type(screen.getByLabelText("Name"), "Rain coat");
		await user.click(screen.getByRole("button", { name: "Add item" }));
		expect(screen.getByLabelText("Name")).toHaveValue("Rain coat");
	});

	it("needs at least 2 items before compatibility can be set up", () => {
		renderItems([shoes]);
		expect(screen.getByText("Add at least 2 items to set up compatibility.")).toBeInTheDocument();
	});

	it("shows what each item goes with, and toggles compatibility for the picked item", async () => {
		const { user, onToggleCompatible } = renderItems([shirt, jeans, shoes]);
		const shirtCard = screen.getByRole("link", { name: "White shirt" }).closest("li")!;
		expect(within(shirtCard).getByText("Blue jeans")).toBeInTheDocument();

		// White shirt is picked first; the pills are the other items.
		const pills = within(screen.getByRole("group", { name: "Goes with White shirt" }));
		expect(pills.getByRole("checkbox", { name: "Blue jeans" })).toBeChecked();
		await user.click(pills.getByRole("checkbox", { name: "Loafers" }));
		expect(onToggleCompatible).toHaveBeenCalledWith("shirt", "shoes");

		await user.selectOptions(screen.getByLabelText("Item"), "Loafers");
		expect(screen.getByRole("group", { name: "Goes with Loafers" })).toBeInTheDocument();
	});

	it("disables a pill until its change is saved, so a double click sends one request", async () => {
		const saving = deferred<void>();
		const { user, onToggleCompatible } = renderItems([shirt, jeans, shoes], undefined, jest.fn().mockReturnValue(saving.promise));
		const loafers = screen.getByRole("checkbox", { name: "Loafers" });
		await user.dblClick(loafers);
		expect(onToggleCompatible).toHaveBeenCalledTimes(1);
		expect(loafers).toBeDisabled();
		saving.resolve();
		await waitFor(() => expect(loafers).toBeEnabled());
	});

	it("each card links to the item's page and has remove and drag buttons", async () => {
		const { user, onRemove, dragHandle } = renderItems([shirt, jeans]);
		expect(screen.getByRole("link", { name: "White shirt" })).toHaveAttribute("href", "/items/shirt");
		await user.click(screen.getByRole("button", { name: "Remove Blue jeans" }));
		expect(onRemove).toHaveBeenCalledWith("jeans");

		expect(screen.getByRole("button", { name: "Reorder White shirt" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Reorder Blue jeans" })).toBeInTheDocument();
		expect(dragHandle).toHaveBeenCalledWith("shirt");
		expect(dragHandle).toHaveBeenCalledWith("jeans");
	});

	it("has nothing to drag when there's only one item", () => {
		renderItems([shoes]);
		expect(screen.queryByRole("button", { name: /Reorder/ })).not.toBeInTheDocument();
	});
});

describe("Outfits", () => {
	function renderOutfits(outfits: Outfit[], onAdd = jest.fn().mockResolvedValue(true)) {
		const onUpdate = jest.fn().mockResolvedValue(true);
		const dragHandle = fakeDragHandle();
		renderAt(
			<Outfits
				items={[shirt, jeans, shoes]}
				outfits={outfits}
				onAdd={onAdd}
				onUpdate={onUpdate}
				onRemove={jest.fn()}
				dragHandle={dragHandle}
			/>,
		);
		return { user: userEvent.setup(), onAdd, onUpdate, dragHandle };
	}

	it("can only save once it has a name and at least one item", async () => {
		const { user, onAdd } = renderOutfits([]);
		const save = screen.getByRole("button", { name: "Save outfit" });
		expect(save).toBeDisabled();
		await user.type(screen.getByLabelText("Outfit name"), "Brunch");
		expect(save).toBeDisabled();
		await user.click(screen.getByRole("checkbox", { name: "White shirt" }));
		await user.click(save);
		expect(onAdd).toHaveBeenCalledWith("Brunch", ["shirt"]);
		expect(screen.getByLabelText("Outfit name")).toHaveValue("");
		expect(screen.getByLabelText("Outfit name")).toHaveAttribute("maxLength", "100");
		expect(screen.getByRole("checkbox", { name: "White shirt" })).not.toBeChecked();
	});

	it("saves only once when Save outfit is double-clicked", async () => {
		const saving = deferred<boolean>();
		const { user, onAdd } = renderOutfits([], jest.fn().mockReturnValue(saving.promise));
		await user.type(screen.getByLabelText("Outfit name"), "Brunch");
		await user.click(screen.getByRole("checkbox", { name: "White shirt" }));
		await user.dblClick(screen.getByRole("button", { name: "Save outfit" }));
		expect(onAdd).toHaveBeenCalledTimes(1);
		saving.resolve(true);
		await waitFor(() => expect(screen.getByLabelText("Outfit name")).toHaveValue(""));
	});

	it("outlines items that go with everything picked so far", async () => {
		const { user } = renderOutfits([]);
		await user.click(screen.getByRole("checkbox", { name: "White shirt" }));
		expect(screen.getByRole("checkbox", { name: "Blue jeans" }).closest("label")).toHaveClass("suggested");
		expect(screen.getByRole("checkbox", { name: "Loafers" }).closest("label")).not.toHaveClass("suggested");
		expect(screen.getByText(/go with everything you've picked/)).toBeInTheDocument();
	});

	it("lists saved outfits with their items", () => {
		renderOutfits([brunch]);
		const card = screen.getByRole("link", { name: "Brunch" }).closest("li")!;
		expect(within(card).getByText("White shirt")).toBeInTheDocument();
		expect(within(card).getByText("Blue jeans")).toBeInTheDocument();
	});

	it("Edit loads an outfit into the form; saving changes it, Cancel doesn't", async () => {
		const { user, onAdd, onUpdate } = renderOutfits([brunch, errands]);
		await user.click(screen.getByRole("button", { name: "Edit Brunch" }));
		expect(screen.getByText("Editing “Brunch”")).toBeInTheDocument();
		expect(screen.getByLabelText("Outfit name")).toHaveValue("Brunch");
		expect(screen.getByRole("checkbox", { name: "White shirt" })).toBeChecked();
		expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.getByLabelText("Outfit name")).toHaveValue("");
		expect(screen.queryByText(/Editing/)).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Edit Brunch" }));
		await user.clear(screen.getByLabelText("Outfit name"));
		await user.type(screen.getByLabelText("Outfit name"), "Late brunch");
		await user.click(screen.getByRole("checkbox", { name: "Blue jeans" }));
		await user.click(screen.getByRole("checkbox", { name: "Loafers" }));
		await user.click(screen.getByRole("button", { name: "Save changes" }));
		expect(onUpdate).toHaveBeenCalledWith("brunch", "Late brunch", ["shirt", "shoes"]);
		expect(onAdd).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Save outfit" })).toBeInTheDocument();
	});

	it("each outfit card has a drag button", () => {
		const { dragHandle } = renderOutfits([brunch, errands]);
		expect(screen.getByRole("button", { name: "Reorder Errands" })).toBeInTheDocument();
		expect(dragHandle).toHaveBeenCalledWith("errands");
	});
});

describe("Occasions", () => {
	function renderOccasions(onAdd = jest.fn().mockResolvedValue(true)) {
		const onUpdate = jest.fn().mockResolvedValue(true);
		const onRemove = jest.fn();
		const dragHandle = fakeDragHandle();
		const party: Occasion = { id: "party", name: "Party", outfitIds: ["errands"] };
		renderAt(
			<Occasions
				outfits={[brunch, errands]}
				occasions={[weekend, party]}
				onAdd={onAdd}
				onUpdate={onUpdate}
				onRemove={onRemove}
				dragHandle={dragHandle}
			/>,
		);
		return { user: userEvent.setup(), onAdd, onUpdate, onRemove, dragHandle };
	}

	it("saves an occasion with the picked outfits, and has remove and drag buttons", async () => {
		const { user, onAdd, onRemove, dragHandle } = renderOccasions();
		await user.type(screen.getByLabelText("Occasion or category"), "Date night");
		await user.click(screen.getByRole("checkbox", { name: "Brunch" }));
		await user.click(screen.getByRole("button", { name: "Save occasion" }));
		expect(onAdd).toHaveBeenCalledWith("Date night", ["brunch"]);
		expect(screen.getByLabelText("Occasion or category")).toHaveAttribute("maxLength", "100");

		await user.click(screen.getByRole("button", { name: "Remove Weekend" }));
		expect(onRemove).toHaveBeenCalledWith("weekend");
		expect(screen.getByRole("button", { name: "Reorder Weekend" })).toBeInTheDocument();
		expect(dragHandle).toHaveBeenCalledWith("weekend");
	});

	it("saves only once when Save occasion is double-clicked", async () => {
		const saving = deferred<boolean>();
		const { user, onAdd } = renderOccasions(jest.fn().mockReturnValue(saving.promise));
		await user.type(screen.getByLabelText("Occasion or category"), "Date night");
		await user.click(screen.getByRole("checkbox", { name: "Brunch" }));
		await user.dblClick(screen.getByRole("button", { name: "Save occasion" }));
		expect(onAdd).toHaveBeenCalledTimes(1);
		saving.resolve(true);
		await waitFor(() => expect(screen.getByLabelText("Occasion or category")).toHaveValue(""));
	});

	it("edits an occasion's name and outfits", async () => {
		const { user, onUpdate } = renderOccasions();
		await user.click(screen.getByRole("button", { name: "Edit Weekend" }));
		expect(screen.getByLabelText("Occasion or category")).toHaveValue("Weekend");
		await user.click(screen.getByRole("checkbox", { name: "Errands" }));
		await user.click(screen.getByRole("button", { name: "Save changes" }));
		expect(onUpdate).toHaveBeenCalledWith("weekend", "Weekend", ["brunch", "errands"]);
	});
});

describe("Detail", () => {
	const saved = { items: [shirt, jeans, shoes], outfits: [brunch], occasions: [weekend] };

	function renderDetail(path: string) {
		renderAt(
			<Routes>
				<Route path="/items/:id" element={<Detail kind="item" {...saved} />} />
				<Route path="/outfits/:id" element={<Detail kind="outfit" {...saved} />} />
				<Route path="/occasions/:id" element={<Detail kind="occasion" {...saved} />} />
			</Routes>,
			path,
		);
	}

	// The links (tiles) in the section with this heading.
	function tilesUnder(heading: string) {
		const section = screen.getByRole("heading", { name: heading }).closest("section")!;
		return within(section)
			.queryAllByRole("link")
			.map((link) => link.getAttribute("href"));
	}

	it("an item page shows what it goes with, its outfits and its occasions", () => {
		renderDetail("/items/shirt");
		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("White shirt");
		expect(tilesUnder("Goes with")).toEqual(["/items/jeans"]);
		expect(tilesUnder("Outfits")).toEqual(["/outfits/brunch"]);
		expect(tilesUnder("Occasions")).toEqual(["/occasions/weekend"]);
		expect(screen.getByRole("link", { name: "← Home" })).toHaveAttribute("href", "/");
		expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
	});

	it("says when an item isn't linked to anything yet", () => {
		renderDetail("/items/shoes");
		expect(screen.getByText("Not matched with anything yet.")).toBeInTheDocument();
		expect(screen.getByText("Not in any outfits yet.")).toBeInTheDocument();
	});

	it("an outfit page shows its items and occasions", () => {
		renderDetail("/outfits/brunch");
		expect(screen.getByText("2 items")).toBeInTheDocument();
		expect(tilesUnder("Items")).toEqual(["/items/shirt", "/items/jeans"]);
		expect(tilesUnder("Occasions")).toEqual(["/occasions/weekend"]);
	});

	it("an occasion page shows its outfits and every item in them", () => {
		renderDetail("/occasions/weekend");
		expect(screen.getByText("1 outfit")).toBeInTheDocument();
		expect(tilesUnder("Outfits")).toEqual(["/outfits/brunch"]);
		expect(tilesUnder("Items")).toEqual(["/items/shirt", "/items/jeans"]);
	});

	it("says when the thing doesn't exist, without blaming a refresh", () => {
		renderDetail("/outfits/nope");
		expect(screen.getByText("This outfit doesn't exist. It may have been deleted.")).toBeInTheDocument();
	});
});

describe("Header", () => {
	it("shows nothing for the account while still checking", () => {
		renderAt(<Header user={undefined} onLogIn={jest.fn()} onLogOut={jest.fn()} />);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("shows Log in when logged out", () => {
		renderAt(<Header user={null} onLogIn={jest.fn()} onLogOut={jest.fn()} />);
		expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
	});

	it.each(["/", "/items/shirt"])("on %s, shows links to the home page's sections, the account, and Log out", async (path) => {
		const onLogOut = jest.fn();
		renderAt(<Header user={{ username: "alice" }} onLogIn={jest.fn()} onLogOut={onLogOut} />, path);
		const links = within(screen.getByRole("navigation")).getAllByRole("link");
		expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
			["Search", "/#search"],
			["Items", "/#items"],
			["Outfits", "/#outfits"],
			["Occasions", "/#occasions"],
		]);
		expect(screen.getByRole("link", { name: "@alice" })).toHaveAttribute("href", "/account");
		await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
		expect(onLogOut).toHaveBeenCalled();
	});
});

describe("Login", () => {
	function renderLogin() {
		const onLogIn = jest.fn();
		render(<Login onLogIn={onLogIn} />);
		return { user: userEvent.setup(), onLogIn };
	}

	it("opens a panel from the Log in button, and Escape closes it", async () => {
		const { user } = renderLogin();
		await user.click(screen.getByRole("button", { name: "Log in" }));
		expect(screen.getByRole("region", { name: "Log in" })).toBeInTheDocument();
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("region")).not.toBeInTheDocument();
	});

	it("the password field's name is just Password, and Show has its own name", async () => {
		const { user } = renderLogin();
		await user.click(screen.getByRole("button", { name: "Log in" }));
		expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
		expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
	});

	it("logs in with username and password", async () => {
		const calls = mockApi({ "POST /users/login": () => [200, { user: { username: "alice" } }] });
		const { user, onLogIn } = renderLogin();
		await user.click(screen.getByRole("button", { name: "Log in" }));
		await user.type(screen.getByLabelText("Username"), "alice");
		await user.type(screen.getByLabelText("Password"), "password123");
		await user.click(submitButton());
		await waitFor(() => expect(onLogIn).toHaveBeenCalledWith({ username: "alice" }));
		expect(calls[0].body).toEqual({ username: "alice", password: "password123" });
	});

	it("signs up, with the username and password rules only in sign up mode", async () => {
		const calls = mockApi({ "POST /users/signup": () => [201, { user: { username: "newbie" } }] });
		const { user, onLogIn } = renderLogin();
		await user.click(screen.getByRole("button", { name: "Log in" }));
		expect(screen.getByLabelText("Password")).not.toHaveAttribute("minLength");

		await user.click(screen.getByRole("button", { name: "Sign up" }));
		expect(screen.getByLabelText("Username")).toHaveAttribute("minLength", "3");
		expect(screen.getByLabelText("Password")).toHaveAttribute("minLength", "8");
		await user.type(screen.getByLabelText("Username"), "newbie");
		await user.type(screen.getByLabelText("Password"), "password123");
		await user.click(screen.getByRole("button", { name: "Create account" }));
		await waitFor(() => expect(onLogIn).toHaveBeenCalledWith({ username: "newbie" }));
		expect(calls[0]).toEqual({
			method: "POST",
			path: "/users/signup",
			body: { username: "newbie", password: "password123" },
		});
	});

	it("shows the server's error until you change the fields, and lets you try again", async () => {
		mockApi({ "POST /users/signup": () => [409, { error: "That username is taken" }] });
		const { user, onLogIn } = renderLogin();
		await user.click(screen.getByRole("button", { name: "Log in" }));
		await user.click(screen.getByRole("button", { name: "Sign up" }));
		await user.type(screen.getByLabelText("Username"), "alice");
		await user.type(screen.getByLabelText("Password"), "password123");
		await user.click(screen.getByRole("button", { name: "Create account" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("That username is taken");
		expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
		expect(onLogIn).not.toHaveBeenCalled();

		await user.type(screen.getByLabelText("Username"), "2");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("closing the panel forgets the password and the error", async () => {
		mockApi({ "POST /users/login": () => [401, { error: "Incorrect username or password" }] });
		const { user } = renderLogin();
		await user.click(screen.getByRole("button", { name: "Log in" }));
		await user.type(screen.getByLabelText("Username"), "alice");
		await user.type(screen.getByLabelText("Password"), "wrongpass");
		await user.click(submitButton());
		expect(await screen.findByRole("alert")).toBeInTheDocument();

		// Closing with the header button, then opening again.
		await user.click(screen.getAllByRole("button", { name: "Log in" })[0]);
		await user.click(screen.getByRole("button", { name: "Log in" }));
		expect(screen.getByLabelText("Username")).toHaveValue("alice");
		expect(screen.getByLabelText("Password")).toHaveValue("");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("Show reveals the password", async () => {
		const { user } = renderLogin();
		await user.click(screen.getByRole("button", { name: "Log in" }));
		expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
		await user.click(screen.getByRole("button", { name: "Show password" }));
		expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
	});
});

describe("Account", () => {
	function renderAccount() {
		const onLogOut = jest.fn();
		const onDeleted = jest.fn();
		renderAt(<Account username="alice" onLogOut={onLogOut} onDeleted={onDeleted} />);
		return { user: userEvent.setup(), onLogOut, onDeleted };
	}

	it("shows the username and logs out", async () => {
		const { user, onLogOut } = renderAccount();
		expect(screen.getByText("@alice")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Log out" }));
		expect(onLogOut).toHaveBeenCalled();
	});

	it("deletes the account with the password, after asking", async () => {
		const calls = mockApi({ "DELETE /users/me": () => [200, { ok: true }] });
		const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
		const { user, onDeleted } = renderAccount();
		await user.type(screen.getByLabelText("Your password"), "password123");
		await user.click(screen.getByRole("button", { name: "Delete my account" }));
		expect(confirm).toHaveBeenCalledWith(expect.stringContaining("can't be undone"));
		await waitFor(() => expect(onDeleted).toHaveBeenCalled());
		expect(calls).toEqual([{ method: "DELETE", path: "/users/me", body: { password: "password123" } }]);
	});

	it("doesn't delete if you cancel, and shows a wrong password", async () => {
		const calls = mockApi({ "DELETE /users/me": () => [403, { error: "Incorrect password" }] });
		const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
		const { user, onDeleted } = renderAccount();
		await user.type(screen.getByLabelText("Your password"), "wrongpass");
		await user.click(screen.getByRole("button", { name: "Delete my account" }));
		expect(calls).toEqual([]);

		confirm.mockReturnValue(true);
		await user.click(screen.getByRole("button", { name: "Delete my account" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password");
		expect(onDeleted).not.toHaveBeenCalled();
	});
});

// --- The whole app against a fake API ---

describe("App", () => {
	// A tiny in-memory server: just enough for the App's calls.
	function fakeServer(options: { loggedIn: boolean }) {
		const state = {
			user: options.loggedIn ? { username: "alice" } : null,
			items: [shirt, jeans, shoes] as Item[],
			outfits: [brunch] as Outfit[],
			occasions: [weekend] as Occasion[],
		};
		// "/outfits/brunch" → "brunch"
		const idIn = (path: string) => path.split("/")[2];
		// Puts the list in the order of the ids sent, like PUT /api/.../order.
		const inOrder = <T extends { id: string }>(list: T[], ids: string[]) =>
			ids.map((id) => list.find((thing) => thing.id === id)!);
		const calls = mockApi({
			"GET /users/me": () => [200, { user: state.user }],
			"POST /users/login": () => {
				state.user = { username: "alice" };
				return [200, { user: state.user }];
			},
			"POST /users/logout": () => {
				state.user = null;
				return [200, { ok: true }];
			},
			"DELETE /users/me": () => {
				state.user = null;
				return [200, { ok: true }];
			},
			"GET /items": () => [200, { items: state.items }],
			"GET /outfits": () => [200, { outfits: state.outfits }],
			"GET /occasions": () => [200, { occasions: state.occasions }],
			"POST /items": (body) => {
				const { name, type } = body as Item;
				const item: Item = { id: name.toLowerCase(), name, type, compatibleIds: [] };
				state.items = [...state.items, item];
				return [201, { item }];
			},
			"PUT /items/order": (body) => {
				state.items = inOrder(state.items, (body as { ids: string[] }).ids);
				return [200, { ok: true }];
			},
			// Like the real server: deleting jeans takes it out of Brunch.
			"DELETE /items/*": (_body, path) => {
				const id = idIn(path);
				state.items = state.items.filter((item) => item.id !== id);
				state.outfits = state.outfits.map((outfit) => ({
					...outfit,
					itemIds: outfit.itemIds.filter((itemId) => itemId !== id),
				}));
				return [200, { ok: true }];
			},
			// Only marking is handled; unmarking (DELETE) is left as a 404 to test the error banner.
			"PUT /items/*/compatible/*": (_body, path) => {
				const [, , id, , otherId] = path.split("/");
				state.items = state.items.map((item) =>
					item.id === id ? { ...item, compatibleIds: [...item.compatibleIds, otherId] } : item,
				);
				return [200, { item: state.items.find((item) => item.id === id) }];
			},
			"POST /outfits": (body) => {
				const { name, itemIds } = body as Outfit;
				const outfit: Outfit = { id: name.toLowerCase(), name, itemIds };
				state.outfits = [...state.outfits, outfit];
				return [201, { outfit }];
			},
			"PUT /outfits/*": (body, path) => {
				const outfit = { id: idIn(path), ...(body as { name: string; itemIds: string[] }) };
				state.outfits = state.outfits.map((each) => (each.id === outfit.id ? outfit : each));
				return [200, { outfit }];
			},
			// Like the real server: occasions left with no outfits are deleted too.
			"DELETE /outfits/*": (_body, path) => {
				const id = idIn(path);
				state.outfits = state.outfits.filter((outfit) => outfit.id !== id);
				state.occasions = state.occasions
					.map((occasion) => ({ ...occasion, outfitIds: occasion.outfitIds.filter((each) => each !== id) }))
					.filter((occasion) => occasion.outfitIds.length > 0);
				return [200, { ok: true }];
			},
			"POST /occasions": (body) => {
				const { name, outfitIds } = body as Occasion;
				const occasion: Occasion = { id: name.toLowerCase(), name, outfitIds };
				state.occasions = [...state.occasions, occasion];
				return [201, { occasion }];
			},
			"DELETE /occasions/*": (_body, path) => {
				state.occasions = state.occasions.filter((occasion) => occasion.id !== idIn(path));
				return [200, { ok: true }];
			},
		});
		return { state, calls, user: userEvent.setup() };
	}

	function renderApp(path = "/") {
		return renderAt(<App />, path);
	}

	const section = (id: string) => within(document.getElementById(id)!);
	// The names on the cards in one section, in order.
	const cardNames = (id: string) =>
		section(id)
			.getAllByRole("listitem")
			.map((card) => card.querySelector(".card-link")?.textContent)
			.filter(Boolean);

	it("asks you to log in when nobody is logged in", async () => {
		fakeServer({ loggedIn: false });
		renderApp();
		expect(screen.getByText("Loading…")).toBeInTheDocument();
		expect(await screen.findByText("Log in or sign up to start saving your outfits.")).toBeInTheDocument();
		expect(document.getElementById("items")).toBeNull();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("after a refresh, stays logged in and loads the wardrobe", async () => {
		fakeServer({ loggedIn: true });
		renderApp();
		expect(await screen.findByText("@alice")).toBeInTheDocument();
		expect(await screen.findByRole("link", { name: "White shirt" })).toBeInTheDocument();
		expect(section("outfits").getByRole("link", { name: "Brunch" })).toBeInTheDocument();
		expect(section("occasions").getByRole("link", { name: "Weekend" })).toBeInTheDocument();
	});

	it("a detail page works straight away after a refresh", async () => {
		fakeServer({ loggedIn: true });
		renderApp("/outfits/brunch");
		expect(await screen.findByRole("heading", { level: 1, name: "Brunch" })).toBeInTheDocument();
	});

	it("an unknown address shows Page not found, with a way home", async () => {
		const { user } = fakeServer({ loggedIn: true });
		renderApp("/nonexistent");
		expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
		await user.click(screen.getByRole("link", { name: "← Home" }));
		expect(screen.getByText("Your wardrobe, organized.")).toBeInTheDocument();
	});

	it("a header link opens the home page and scrolls to its section", async () => {
		const { user } = fakeServer({ loggedIn: true });
		renderApp("/items/shirt");
		await screen.findByRole("heading", { level: 1, name: "White shirt" });
		await user.click(within(screen.getByRole("navigation")).getByRole("link", { name: "Outfits" }));
		expect(document.getElementById("outfits")).toBeInTheDocument();
		expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
	});

	it("logging in from the header loads the wardrobe", async () => {
		const { user } = fakeServer({ loggedIn: false });
		renderApp();
		await user.click(await screen.findByRole("button", { name: "Log in" }));
		await user.type(screen.getByLabelText("Username"), "alice");
		await user.type(screen.getByLabelText("Password"), "password123");
		await user.click(submitButton());
		expect(await screen.findByRole("link", { name: "White shirt" })).toBeInTheDocument();
	});

	it("adds an item through the API", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		await user.type(section("items").getByLabelText("Name"), "Rain coat");
		await user.selectOptions(section("items").getByLabelText("Type"), "Outerwear");
		await user.click(section("items").getByRole("button", { name: "Add item" }));
		expect(await screen.findByRole("link", { name: "Rain coat" })).toBeInTheDocument();
		expect(calls).toContainEqual({ method: "POST", path: "/items", body: { name: "Rain coat", type: "Outerwear" } });
	});

	// jsdom has no layout, so "what's under the pointer" is faked: the card whose name is given.
	function pointAt(name: string) {
		document.elementFromPoint = () => section("items").getByRole("link", { name });
	}

	it("dragging a card over another moves it there, and letting go saves the new order", async () => {
		const { calls, state } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		const grip = () => section("items").getByRole("button", { name: "Reorder Loafers" });

		fireEvent.pointerDown(grip(), { pointerId: 1 });
		expect(grip()).toHaveAttribute("data-dragging", "true");
		pointAt("Blue jeans");
		fireEvent.pointerMove(grip(), { pointerId: 1, clientY: 300 });
		expect(cardNames("items")).toEqual(["White shirt", "Loafers", "Blue jeans"]);
		pointAt("White shirt");
		fireEvent.pointerMove(grip(), { pointerId: 1, clientY: 300 });
		expect(cardNames("items")).toEqual(["Loafers", "White shirt", "Blue jeans"]);
		// Nothing is saved until the card is let go.
		expect(calls.some((call) => call.path === "/items/order")).toBe(false);

		fireEvent.pointerUp(grip(), { pointerId: 1 });
		expect(grip()).toHaveAttribute("data-dragging", "false");
		await waitFor(() =>
			expect(calls).toContainEqual({ method: "PUT", path: "/items/order", body: { ids: ["shoes", "shirt", "jeans"] } }),
		);
		expect(state.items.map((item) => item.id)).toEqual(["shoes", "shirt", "jeans"]);
	});

	it("a drag that ends where it started saves nothing, and cards from other lists are ignored", async () => {
		const { calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		const grip = section("items").getByRole("button", { name: "Reorder Loafers" });
		fireEvent.pointerDown(grip, { pointerId: 1 });
		// Over an outfit card: not in the items list, so nothing moves.
		document.elementFromPoint = () => section("outfits").getByRole("link", { name: "Brunch" });
		fireEvent.pointerMove(grip, { pointerId: 1, clientY: 300 });
		fireEvent.pointerUp(grip, { pointerId: 1 });
		expect(cardNames("items")).toEqual(["White shirt", "Blue jeans", "Loafers"]);
		expect(calls.some((call) => call.path === "/items/order")).toBe(false);
	});

	it("the arrow keys move a card from its drag button, and save straight away", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		section("items").getByRole("button", { name: "Reorder White shirt" }).focus();
		await user.keyboard("{ArrowRight}");
		expect(cardNames("items")).toEqual(["Blue jeans", "White shirt", "Loafers"]);
		await user.keyboard("{ArrowDown}");
		expect(cardNames("items")).toEqual(["Blue jeans", "Loafers", "White shirt"]);
		// Already last: nothing happens.
		await user.keyboard("{ArrowDown}");
		await user.keyboard("{ArrowUp}");
		expect(cardNames("items")).toEqual(["Blue jeans", "White shirt", "Loafers"]);
		await waitFor(() =>
			expect(calls.filter((call) => call.path === "/items/order").map((call) => call.body)).toEqual([
				{ ids: ["jeans", "shirt", "shoes"] },
				{ ids: ["jeans", "shoes", "shirt"] },
				{ ids: ["jeans", "shirt", "shoes"] },
			]),
		);
	});

	it("if saving the order fails, shows the error and goes back to the server's order", async () => {
		const { user } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		// From now on the server has no order route, so saving the order gets a 404.
		const calls = mockApi({
			"GET /items": () => [200, { items: [shirt, jeans, shoes] }],
			"GET /outfits": () => [200, { outfits: [brunch] }],
			"GET /occasions": () => [200, { occasions: [weekend] }],
		});
		section("items").getByRole("button", { name: "Reorder White shirt" }).focus();
		await user.keyboard("{ArrowRight}");
		expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
		await waitFor(() => expect(cardNames("items")).toEqual(["White shirt", "Blue jeans", "Loafers"]));
		expect(calls[0]).toEqual({ method: "PUT", path: "/items/order", body: { ids: ["jeans", "shirt", "shoes"] } });
	});

	it("asks before deleting an item, listing the outfits and occasions that go with it", async () => {
		const { user, calls, state } = fakeServer({ loggedIn: true });
		const outfitWithJeans: Outfit = { id: "jeans-only", name: "Jeans only", itemIds: ["jeans"] };
		state.outfits = [brunch, outfitWithJeans];
		state.occasions = [weekend, { id: "denim", name: "Denim day", outfitIds: ["jeans-only"] }];
		const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
		renderApp();
		await screen.findByRole("link", { name: "Blue jeans" });
		await user.click(section("items").getByRole("button", { name: "Remove Blue jeans" }));

		const question = confirm.mock.calls[0][0];
		expect(question).toContain('Delete "Blue jeans"?');
		expect(question).toContain('It will be taken out of: "Brunch".');
		expect(question).toContain('These outfits will also be deleted, because they\'d have no items left: "Jeans only".');
		expect(question).toContain(
			'These occasions will also be deleted, because they\'d have no outfits left: "Denim day".',
		);
		await waitFor(() => expect(section("items").queryByRole("link", { name: "Blue jeans" })).not.toBeInTheDocument());
		expect(calls).toContainEqual({ method: "DELETE", path: "/items/jeans", body: undefined });
		const brunchCard = section("outfits").getByRole("link", { name: "Brunch" }).closest("li")!;
		expect(within(brunchCard).queryByText("Blue jeans")).not.toBeInTheDocument();
	});

	it("asks before deleting an unused item too, and doesn't delete if you cancel", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
		renderApp();
		await screen.findByRole("link", { name: "Loafers" });
		await user.click(section("items").getByRole("button", { name: "Remove Loafers" }));
		expect(confirm).toHaveBeenCalledWith(`Delete "Loafers"? This can't be undone.`);
		expect(calls.some((call) => call.method === "DELETE")).toBe(false);
	});

	it("deleting something that's already gone just refreshes the page", async () => {
		const { user, state } = fakeServer({ loggedIn: true });
		jest.spyOn(window, "confirm").mockReturnValue(true);
		renderApp();
		await screen.findByRole("link", { name: "Weekend" });
		// Deleted in another tab: the server says 404 now.
		state.occasions = [];
		globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const path = String(input);
			if (init?.method === "DELETE") {
				return { ok: false, status: 404, json: async () => ({ error: "Occasion not found" }) } as Response;
			}
			const lists: Record<string, unknown> = {
				"/api/items": { items: state.items },
				"/api/outfits": { outfits: state.outfits },
				"/api/occasions": { occasions: state.occasions },
			};
			return { ok: true, status: 200, json: async () => lists[path] } as Response;
		}) as typeof fetch;
		await user.click(section("occasions").getByRole("button", { name: "Remove Weekend" }));
		await waitFor(() => expect(screen.queryByRole("link", { name: "Weekend" })).not.toBeInTheDocument());
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("shows a failed request in a banner you can dismiss, and clears it after the next success", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		// The fake server has no route for unmarking, so this request gets a 404.
		await user.click(section("items").getByRole("checkbox", { name: "Blue jeans" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
		expect(calls[calls.length - 1]).toEqual({
			method: "DELETE",
			path: "/items/shirt/compatible/jeans",
			body: undefined,
		});
		await user.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();

		await user.click(section("items").getByRole("checkbox", { name: "Blue jeans" }));
		expect(await screen.findByRole("alert")).toBeInTheDocument();
		await user.click(section("items").getByRole("checkbox", { name: "Loafers" }));
		await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
	});

	it("marks two items compatible through the API, updating both cards", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		const picker = within(section("items").getByRole("group", { name: "Goes with White shirt" }));
		await user.click(picker.getByRole("checkbox", { name: "Loafers" }));

		expect(calls).toContainEqual({ method: "PUT", path: "/items/shirt/compatible/shoes", body: undefined });
		const loafersCard = section("items").getByRole("link", { name: "Loafers" }).closest("li")!;
		await waitFor(() => expect(within(loafersCard).getByText("White shirt")).toBeInTheDocument());
	});

	it("a double click on a pill sends one request, and the screen matches the server", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		const loafers = section("items").getByRole("checkbox", { name: "Loafers" });
		await user.dblClick(loafers);
		await waitFor(() => expect(loafers).toBeEnabled());
		expect(calls.filter((call) => call.path === "/items/shirt/compatible/shoes")).toHaveLength(1);
		expect(loafers).toBeChecked();
	});

	it("saves an outfit, then an occasion for it", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });

		await user.type(section("outfits").getByLabelText("Outfit name"), "Errands");
		await user.click(section("outfits").getByRole("checkbox", { name: "Loafers" }));
		await user.click(section("outfits").getByRole("button", { name: "Save outfit" }));
		expect(await section("outfits").findByRole("link", { name: "Errands" })).toBeInTheDocument();
		expect(calls).toContainEqual({ method: "POST", path: "/outfits", body: { name: "Errands", itemIds: ["shoes"] } });

		await user.type(section("occasions").getByLabelText("Occasion or category"), "Saturday");
		await user.click(section("occasions").getByRole("checkbox", { name: "Errands" }));
		await user.click(section("occasions").getByRole("button", { name: "Save occasion" }));
		expect(await section("occasions").findByRole("link", { name: "Saturday" })).toBeInTheDocument();
	});

	it("edits an outfit through the API", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		await user.click(section("outfits").getByRole("button", { name: "Edit Brunch" }));
		await user.type(section("outfits").getByLabelText("Outfit name"), " club");
		await user.click(section("outfits").getByRole("button", { name: "Save changes" }));
		expect(await section("outfits").findByRole("link", { name: "Brunch club" })).toBeInTheDocument();
		expect(calls).toContainEqual({
			method: "PUT",
			path: "/outfits/brunch",
			body: { name: "Brunch club", itemIds: ["shirt", "jeans"] },
		});
	});

	it("asks before deleting an outfit that's in an occasion; the emptied occasion goes too", async () => {
		const { user } = fakeServer({ loggedIn: true });
		const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		await user.click(section("outfits").getByRole("button", { name: "Remove Brunch" }));

		expect(confirm).toHaveBeenCalledWith(
			expect.stringContaining('These occasions will also be deleted, because they\'d have no outfits left: "Weekend".'),
		);
		await waitFor(() => expect(screen.queryByRole("link", { name: "Brunch" })).not.toBeInTheDocument());
		expect(screen.queryByRole("link", { name: "Weekend" })).not.toBeInTheDocument();
		// With no outfits left, the occasions section goes back to its locked message.
		expect(screen.getByText("Save an outfit first to set up occasions.")).toBeInTheDocument();
	});

	it("asks before deleting an occasion", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
		renderApp();
		await screen.findByRole("link", { name: "Weekend" });
		await user.click(section("occasions").getByRole("button", { name: "Remove Weekend" }));
		expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Its outfits won't be deleted."));
		await waitFor(() => expect(screen.queryByRole("link", { name: "Weekend" })).not.toBeInTheDocument());
		expect(calls).toContainEqual({ method: "DELETE", path: "/occasions/weekend", body: undefined });
	});

	it("opens an item's page from its card, and Home goes back", async () => {
		const { user } = fakeServer({ loggedIn: true });
		renderApp();
		await user.click(await screen.findByRole("link", { name: "White shirt" }));
		expect(screen.getByRole("heading", { level: 1, name: "White shirt" })).toBeInTheDocument();
		await user.click(screen.getByRole("link", { name: "← Home" }));
		expect(screen.getByText("Your wardrobe, organized.")).toBeInTheDocument();
	});

	it("if the wardrobe can't be loaded, shows the error and a Try again button", async () => {
		let itemsWork = false;
		mockApi({
			"GET /users/me": () => [200, { user: { username: "alice" } }],
			"GET /items": () => (itemsWork ? [200, { items: [shirt] }] : [500, { error: "Internal server error" }]),
			"GET /outfits": () => [200, { outfits: [] }],
			"GET /occasions": () => [200, { occasions: [] }],
		});
		const user = userEvent.setup();
		renderApp();
		expect(await screen.findByRole("alert")).toHaveTextContent("Internal server error");
		expect(screen.getByText("Your wardrobe couldn't be loaded.")).toBeInTheDocument();

		itemsWork = true;
		await user.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByRole("link", { name: "White shirt" })).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("if the session has run out when the wardrobe loads, shows you as logged out", async () => {
		mockApi({
			"GET /users/me": () => [200, { user: { username: "alice" } }],
			"GET /items": () => [401, { error: "Not logged in" }],
			"GET /outfits": () => [401, { error: "Not logged in" }],
			"GET /occasions": () => [401, { error: "Not logged in" }],
		});
		renderApp();
		expect(await screen.findByRole("alert")).toHaveTextContent("You've been logged out. Log in again.");
		expect(screen.getByText("Log in or sign up to start saving your outfits.")).toBeInTheDocument();
	});

	it("shows a message if the server can't be reached on page load", async () => {
		globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
		renderApp();
		expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
		expect(screen.getByText("Log in or sign up to start saving your outfits.")).toBeInTheDocument();
	});

	it("shows you as logged out if the session runs out", async () => {
		const { user, state } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		state.user = null;
		globalThis.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "Not logged in" }) }) as Response);
		await user.type(section("items").getByLabelText("Name"), "Hat");
		await user.click(section("items").getByRole("button", { name: "Add item" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("You've been logged out. Log in again.");
		expect(screen.getByText("Log in or sign up to start saving your outfits.")).toBeInTheDocument();
	});

	it("logging out clears the wardrobe", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		await user.click(screen.getByRole("button", { name: "Log out" }));
		expect(await screen.findByText("Log in or sign up to start saving your outfits.")).toBeInTheDocument();
		expect(calls).toContainEqual({ method: "POST", path: "/users/logout", body: undefined });
		expect(screen.queryByText("White shirt")).not.toBeInTheDocument();
	});

	it("if logging out fails, stays logged in and says why", async () => {
		const { user } = fakeServer({ loggedIn: true });
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
		await user.click(screen.getByRole("button", { name: "Log out" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
		expect(screen.getByText("@alice")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "White shirt" })).toBeInTheDocument();
	});

	it("the account page deletes the account and goes back to the logged-out home page", async () => {
		const { user, calls } = fakeServer({ loggedIn: true });
		jest.spyOn(window, "confirm").mockReturnValue(true);
		renderApp();
		await screen.findByRole("link", { name: "White shirt" });
		await user.click(screen.getByRole("link", { name: "@alice" }));
		expect(screen.getByRole("heading", { level: 1, name: "Your account" })).toBeInTheDocument();
		await user.type(screen.getByLabelText("Your password"), "password123");
		await user.click(screen.getByRole("button", { name: "Delete my account" }));
		expect(await screen.findByText("Log in or sign up to start saving your outfits.")).toBeInTheDocument();
		expect(calls).toContainEqual({ method: "DELETE", path: "/users/me", body: { password: "password123" } });
		expect(screen.queryByText("@alice")).not.toBeInTheDocument();
	});
});

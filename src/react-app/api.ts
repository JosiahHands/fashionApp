import type { Item, ItemType, Occasion, Outfit, User } from "../shared/types";

// Every call the front end makes to the Worker's API (src/worker/routes).
// The session cookie is sent automatically because the API is on the same site.

// An error from the API, carrying the message it sent back, like "That username is taken".
export class ApiError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

// Sends one request and returns the JSON it gets back.
// Throws ApiError if the server says no, or can't be reached (status 0).
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`/api${path}`, {
			method,
			headers: body === undefined ? undefined : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
	}
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new ApiError(data.error ?? "Something went wrong. Try again.", response.status);
	}
	return data as T;
}

// --- Account ---

// The logged-in user, or null if nobody is logged in.
export async function getCurrentUser(): Promise<User | null> {
	try {
		const { user } = await request<{ user: User }>("GET", "/users/me");
		return user;
	} catch (err) {
		if (err instanceof ApiError && err.status === 401) {
			return null;
		}
		throw err;
	}
}

export async function signUp(username: string, password: string): Promise<User> {
	const { user } = await request<{ user: User }>("POST", "/users/signup", { username, password });
	return user;
}

export async function logIn(username: string, password: string): Promise<User> {
	const { user } = await request<{ user: User }>("POST", "/users/login", { username, password });
	return user;
}

export async function logOut(): Promise<void> {
	await request("POST", "/users/logout");
}

// --- Wardrobe ---

// Everything the logged-in user has saved, loaded all at once.
export async function loadWardrobe(): Promise<{ items: Item[]; outfits: Outfit[]; occasions: Occasion[] }> {
	const [{ items }, { outfits }, { occasions }] = await Promise.all([
		request<{ items: Item[] }>("GET", "/items"),
		request<{ outfits: Outfit[] }>("GET", "/outfits"),
		request<{ occasions: Occasion[] }>("GET", "/occasions"),
	]);
	return { items, outfits, occasions };
}

export async function createItem(name: string, type: ItemType): Promise<Item> {
	const { item } = await request<{ item: Item }>("POST", "/items", { name, type });
	return item;
}

export async function deleteItem(id: string): Promise<void> {
	await request("DELETE", `/items/${encodeURIComponent(id)}`);
}

// Marks (or unmarks) two items as going together. The server updates both.
export async function setCompatible(id: string, otherId: string, compatible: boolean): Promise<void> {
	const path = `/items/${encodeURIComponent(id)}/compatible/${encodeURIComponent(otherId)}`;
	await request(compatible ? "PUT" : "DELETE", path);
}

export async function createOutfit(name: string, itemIds: string[]): Promise<Outfit> {
	const { outfit } = await request<{ outfit: Outfit }>("POST", "/outfits", { name, itemIds });
	return outfit;
}

export async function deleteOutfit(id: string): Promise<void> {
	await request("DELETE", `/outfits/${encodeURIComponent(id)}`);
}

export async function createOccasion(name: string, outfitIds: string[]): Promise<Occasion> {
	const { occasion } = await request<{ occasion: Occasion }>("POST", "/occasions", { name, outfitIds });
	return occasion;
}

export async function deleteOccasion(id: string): Promise<void> {
	await request("DELETE", `/occasions/${encodeURIComponent(id)}`);
}

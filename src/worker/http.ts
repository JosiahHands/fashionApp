import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export function badRequest(message: string): HTTPException {
	return new HTTPException(400, { message });
}

// Parses the request body as a JSON object, or throws 400.
export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
	const body: unknown = await c.req.json().catch(() => null);
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw badRequest("Body must be a JSON object");
	}
	return body as Record<string, unknown>;
}

// A name that isn't blank and is at most 100 characters, trimmed. Otherwise throws 400.
export function readName(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw badRequest(`${field} is required`);
	}
	if (value.trim().length > 100) {
		throw badRequest(`${field} must be 100 characters or fewer`);
	}
	return value.trim();
}

// D1 allows at most 100 values per query, and checking the ids uses one more for the user id.
const MAX_IDS = 50;

// A list of 1–50 ids, with duplicates removed. Otherwise throws 400.
export function readIds(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw badRequest(`${field} must be a list with at least one id`);
	}
	if (!value.every((id) => typeof id === "string")) {
		throw badRequest(`${field} must only contain ids`);
	}
	const ids = [...new Set(value as string[])];
	if (ids.length > MAX_IDS) {
		throw badRequest(`${field} can have at most ${MAX_IDS} ids`);
	}
	return ids;
}

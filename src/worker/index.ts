import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./auth";
import { items } from "./routes/items";
import { occasions } from "./routes/occasions";
import { outfits } from "./routes/outfits";
import { users } from "./routes/users";

const app = new Hono<AppEnv>();

// `npm run dev` runs on plain http://localhost, so it isn't redirected.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// HTTPS only: plain HTTP is redirected (308 keeps the method and body, e.g. a POST stays a POST),
// and every response tells browsers to use HTTPS for this site for the next year (HSTS).
// The app's pages and files get the same header from public/_headers.
app.use(async (c, next) => {
	const url = new URL(c.req.url);
	if (url.protocol === "http:" && !LOCAL_HOSTS.includes(url.hostname)) {
		return c.redirect(`https://${url.host}${url.pathname}${url.search}`, 308);
	}
	await next();
	c.header("Strict-Transport-Security", "max-age=31536000");
});

// CSRF: stops other websites from making a visitor's browser change things here with their cookie.
// The session cookie is already SameSite=Lax; this also blocks any form-style or body-less
// POST/PUT/DELETE unless the browser says it came from this site (Sec-Fetch-Site or Origin).
// JSON requests from other sites are already blocked by the browser, because this API sends no CORS headers.
app.use("/api/*", csrf());

app.route("/api/users", users);
app.route("/api/items", items);
app.route("/api/outfits", outfits);
app.route("/api/occasions", occasions);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
	if (err instanceof HTTPException) {
		// The CSRF check throws with no message.
		return c.json({ error: err.message || "Request blocked" }, err.status);
	}
	console.error(err);
	return c.json({ error: "Internal server error" }, 500);
});

export default app;

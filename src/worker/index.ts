import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./auth";
import { items } from "./routes/items";
import { occasions } from "./routes/occasions";
import { outfits } from "./routes/outfits";
import { users } from "./routes/users";

const app = new Hono<AppEnv>();

app.route("/api/users", users);
app.route("/api/items", items);
app.route("/api/outfits", outfits);
app.route("/api/occasions", occasions);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
	if (err instanceof HTTPException) {
		return c.json({ error: err.message }, err.status);
	}
	console.error(err);
	return c.json({ error: "Internal server error" }, 500);
});

export default app;

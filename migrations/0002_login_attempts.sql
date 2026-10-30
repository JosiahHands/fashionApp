-- Migration number: 0002 	 2026-10-30T21:42:41.189Z
-- Limits password guessing: each username gets a few tries per time window (see routes/users.ts).
-- username is saved lowercase. Not linked to users, so made-up usernames are limited too.
-- A successful log in deletes the row.
CREATE TABLE login_attempts (
	username TEXT PRIMARY KEY,
	attempts INTEGER NOT NULL,
	window_start INTEGER NOT NULL -- seconds since 1970, when the first try in this window happened
);
CREATE INDEX login_attempts_window_start ON login_attempts (window_start);

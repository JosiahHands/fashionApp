import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "../../../shared/types";
import * as api from "../../api";
import styles from "./Login.module.css";

type LoginProps = {
	onLogIn: (user: User) => void;
};

type Mode = "login" | "signup";

// A small "Log in" button that opens a panel for logging in or signing up.
export function Login({ onLogIn }: LoginProps) {
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<Mode>("login");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	// True while waiting for the server.
	const [pending, setPending] = useState(false);
	// The server's reason it said no, like "That username is taken".
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// While open, clicking outside the panel or pressing Escape closes it.
	useEffect(() => {
		if (!open) {
			return;
		}
		function handleClick(event: MouseEvent) {
			if (!containerRef.current?.contains(event.target as Node)) {
				setOpen(false);
			}
		}
		function handleKey(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKey);
		};
	}, [open]);

	// The browser checks the rules on each input (required, lengths) before this runs,
	// and the server checks them again.
	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);
		try {
			const user =
				mode === "signup"
					? await api.signUp(username.trim(), password)
					: await api.logIn(username.trim(), password);
			// The header swaps this button for the user's name, so the panel goes away.
			onLogIn(user);
		} catch (err) {
			setError((err as Error).message);
			setPending(false);
		}
	}

	function switchMode(next: Mode) {
		setMode(next);
		setError(null);
	}

	return (
		<div className={styles.login} ref={containerRef}>
			<button
				type="button"
				className={styles.trigger}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				Log in
			</button>

			{open && (
				<section className={styles.panel} aria-label={mode === "login" ? "Log in" : "Sign up"}>
					<div className={styles.toggle} role="group" aria-label="Log in or sign up">
						<button
							type="button"
							className={mode === "login" ? styles.active : ""}
							aria-pressed={mode === "login"}
							onClick={() => switchMode("login")}
						>
							Log in
						</button>
						<button
							type="button"
							className={mode === "signup" ? styles.active : ""}
							aria-pressed={mode === "signup"}
							onClick={() => switchMode("signup")}
						>
							Sign up
						</button>
					</div>

					<form className="form" onSubmit={handleSubmit}>
						<label className="field">
							<span className="label">Username</span>
							<input
								type="text"
								value={username}
								autoComplete="username"
								autoCapitalize="off"
								spellCheck={false}
								autoFocus
								required
								// Only new usernames need to meet the rules.
								minLength={mode === "signup" ? 3 : undefined}
								maxLength={mode === "signup" ? 30 : undefined}
								pattern={mode === "signup" ? "[A-Za-z0-9_]+" : undefined}
								title={mode === "signup" ? "Letters, numbers and underscores only." : undefined}
								onChange={(event) => setUsername(event.target.value)}
							/>
							{mode === "signup" && (
								<span className="hint">3–30 letters, numbers or underscores.</span>
							)}
						</label>

						<label className="field">
							<span className="label">Password</span>
							<span className={styles.passwordRow}>
								<input
									type={showPassword ? "text" : "password"}
									value={password}
									autoComplete={mode === "login" ? "current-password" : "new-password"}
									required
									// Only new passwords need to meet the length rule.
									minLength={mode === "signup" ? 8 : undefined}
									onChange={(event) => setPassword(event.target.value)}
								/>
								<button
									type="button"
									className={styles.show}
									aria-label={showPassword ? "Hide password" : "Show password"}
									onClick={() => setShowPassword(!showPassword)}
								>
									{showPassword ? "Hide" : "Show"}
								</button>
							</span>
							{mode === "signup" && <span className="hint">At least 8 characters.</span>}
						</label>

						{error && (
							<p className="form-error" role="alert">
								{error}
							</p>
						)}

						<button type="submit" className={styles.submit} disabled={pending}>
							{mode === "login"
								? pending
									? "Logging in…"
									: "Log in"
								: pending
									? "Creating account…"
									: "Create account"}
						</button>
					</form>
				</section>
			)}
		</div>
	);
}

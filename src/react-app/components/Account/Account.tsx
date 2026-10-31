import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import * as api from "../../api";
import styles from "./Account.module.css";

type AccountProps = {
	username: string;
	onLogOut: () => void;
	// Called once the server has deleted the account.
	onDeleted: () => void;
};

// The logged-in user's account page: log out, or delete the account and everything in it.
export function Account({ username, onLogOut, onDeleted }: AccountProps) {
	const passwordId = useId();
	const [password, setPassword] = useState("");
	// True while waiting for the server.
	const [pending, setPending] = useState(false);
	// The server's reason it said no, like "Incorrect password".
	const [error, setError] = useState<string | null>(null);

	async function handleDelete(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!window.confirm("Delete your account and everything you've saved? This can't be undone.")) {
			return;
		}
		setPending(true);
		setError(null);
		try {
			await api.deleteAccount(password);
			onDeleted();
		} catch (err) {
			setError((err as Error).message);
			setPending(false);
		}
	}

	return (
		<div className={styles.page}>
			<Link to="/" className="button">
				← Home
			</Link>

			<header>
				<h1 className={styles.title}>Your account</h1>
				<p className={styles.username}>@{username}</p>
			</header>

			<section className={styles.card}>
				<h2 className={styles.heading}>Log out</h2>
				<p className={styles.text}>Logs you out on this device. Everything you've saved stays in your account.</p>
				<button type="button" className="button" onClick={onLogOut}>
					Log out
				</button>
			</section>

			<section className={`${styles.card} ${styles.danger}`}>
				<h2 className={styles.heading}>Delete account</h2>
				<p className={styles.text}>
					Deletes your account and everything in it: your items, outfits and occasions. This can't be undone.
				</p>
				<form className="form" onSubmit={handleDelete}>
					<div className="field">
						<label className="label" htmlFor={passwordId}>
							Your password
						</label>
						<input
							id={passwordId}
							type="password"
							value={password}
							autoComplete="current-password"
							required
							onChange={(event) => {
								setPassword(event.target.value);
								setError(null);
							}}
						/>
					</div>
					{error && (
						<p className="form-error" role="alert">
							{error}
						</p>
					)}
					<button type="submit" className={styles.deleteButton} disabled={pending}>
						{pending ? "Deleting…" : "Delete my account"}
					</button>
				</form>
			</section>
		</div>
	);
}

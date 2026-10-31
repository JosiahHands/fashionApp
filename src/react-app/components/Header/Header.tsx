import { Link } from "react-router";
import type { User } from "../../../shared/types";
import { Login } from "../Login/Login";
import styles from "./Header.module.css";

type HeaderProps = {
	// undefined while the page is still checking whether someone is logged in.
	user: User | null | undefined;
	onLogIn: (user: User) => void;
	onLogOut: () => void;
};

// Each link goes to the section on the home page with the matching id, from any page.
const links = [
	{ label: "Search", to: "/#search" },
	{ label: "Items", to: "/#items" },
	{ label: "Outfits", to: "/#outfits" },
	{ label: "Occasions", to: "/#occasions" },
];

export function Header({ user, onLogIn, onLogOut }: HeaderProps) {
	return (
		<header className={styles.header}>
			<div className={styles.inner}>
				<Link className={styles.brand} to="/">
					<span className={styles.logo}>F</span>
					<span className={styles.title}>FashionApp</span>
				</Link>
				{user && (
					<nav className={styles.nav} aria-label="Main">
						<ul className={styles.links}>
							{links.map((link) => (
								<li key={link.to}>
									<Link className={styles.link} to={link.to}>
										{link.label}
									</Link>
								</li>
							))}
						</ul>
					</nav>
				)}
				{user === null && <Login onLogIn={onLogIn} />}
				{user && (
					<div className={styles.account}>
						<Link className={styles.username} to="/account" title="Your account">
							@{user.username}
						</Link>
						<button type="button" className={styles.logOut} onClick={onLogOut}>
							Log out
						</button>
					</div>
				)}
			</div>
		</header>
	);
}

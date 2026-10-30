import { Link, useLocation } from "react-router";
import type { User } from "../../../shared/types";
import { Login } from "../Login/Login";
import styles from "./Header.module.css";

type HeaderProps = {
	// undefined while the page is still checking whether someone is logged in.
	user: User | null | undefined;
	onLogIn: (user: User) => void;
	onLogOut: () => void;
};

// Each link jumps to the section on the home page with the matching id.
const links = [
	{ label: "Items", href: "#items" },
	{ label: "Outfits", href: "#outfits" },
	{ label: "Occasions", href: "#occasions" },
];

export function Header({ user, onLogIn, onLogOut }: HeaderProps) {
	const { pathname } = useLocation();

	return (
		<header className={styles.header}>
			<div className={styles.inner}>
				<Link className={styles.brand} to="/">
					<span className={styles.logo}>F</span>
					<span className={styles.title}>FashionApp</span>
				</Link>
				{/* The section links only work on the home page; other pages have a Home button. */}
				{user && pathname === "/" && (
					<nav className={styles.nav} aria-label="Main">
						<ul className={styles.links}>
							{links.map((link) => (
								<li key={link.href}>
									<a className={styles.link} href={link.href}>
										{link.label}
									</a>
								</li>
							))}
						</ul>
					</nav>
				)}
				{user === null && <Login onLogIn={onLogIn} />}
				{user && (
					<div className={styles.account}>
						<span className={styles.username}>@{user.username}</span>
						<button type="button" className={styles.logOut} onClick={onLogOut}>
							Log out
						</button>
					</div>
				)}
			</div>
		</header>
	);
}

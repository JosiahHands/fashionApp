import styles from "./Footer.module.css";

export function Footer() {
	return (
		<footer className={styles.footer}>
			<p className={styles.text}>© {new Date().getFullYear()} FashionApp</p>
		</footer>
	);
}

import styles from "./Hero.module.css";

export function Hero() {
	return (
		<section className={styles.hero}>
			<h1 className={styles.heading}>Your wardrobe, organized.</h1>
			<p className={styles.text}>
				Save your favorite outfits, keep track of each piece, and find the
				right look for any occasion.
			</p>
		</section>
	);
}

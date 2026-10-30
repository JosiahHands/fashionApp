import type { ReactNode } from "react";
import styles from "./Section.module.css";

type SectionProps = {
	// Matches a header link, e.g. "outfits" for "#outfits".
	id: string;
	title: string;
	description: string;
	children: ReactNode;
};

// A titled card that holds one part of the page.
export function Section({ id, title, description, children }: SectionProps) {
	return (
		<section id={id} className={styles.section}>
			<h2 className={styles.title}>{title}</h2>
			<p className={styles.description}>{description}</p>
			<div className={styles.content}>{children}</div>
		</section>
	);
}

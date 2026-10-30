import styles from "./EmptyState.module.css";

type EmptyStateProps = {
	message: string;
};

// Placeholder shown in a section that has nothing in it yet.
export function EmptyState({ message }: EmptyStateProps) {
	return <p className={styles.empty}>{message}</p>;
}

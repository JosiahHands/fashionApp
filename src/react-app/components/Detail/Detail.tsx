import { useEffect } from "react";
import { Link, useParams } from "react-router";
import type { Item, Occasion, Outfit } from "../../../shared/types";
import { EmptyState } from "../EmptyState/EmptyState";
import styles from "./Detail.module.css";

type DetailProps = {
	kind: "item" | "outfit" | "occasion";
	items: Item[];
	outfits: Outfit[];
	occasions: Occasion[];
};

// A related item, outfit or occasion, shown as a big tile that links to its own page.
type Tile = {
	path: string;
	name: string;
	meta: string;
};

type Group = {
	title: string;
	emptyMessage: string;
	tiles: Tile[];
};

type Page = {
	label: string;
	title: string;
	meta: string;
	groups: Group[];
};

// Full page view of one item, outfit or occasion and everything linked to it.
export function Detail({ kind, items, outfits, occasions }: DetailProps) {
	const { id } = useParams();

	// Start at the top instead of wherever the last page was scrolled to.
	useEffect(() => {
		window.scrollTo(0, 0);
	}, [id]);

	const page = getPage(kind, id, items, outfits, occasions);

	return (
		<div className={styles.page}>
			<Link to="/" className={styles.home}>
				← Home
			</Link>

			{page === null ? (
				<EmptyState message={`This ${kind} doesn't exist. It may have been deleted.`} />
			) : (
				<>
					<header>
						<p className={styles.label}>{page.label}</p>
						<h1 className={styles.title}>{page.title}</h1>
						<p className={styles.meta}>{page.meta}</p>
					</header>

					{page.groups.map((group) => (
						<section key={group.title} className={styles.group}>
							<h2 className={styles.groupTitle}>{group.title}</h2>
							{group.tiles.length === 0 ? (
								<EmptyState message={group.emptyMessage} />
							) : (
								<ul className={styles.tiles}>
									{group.tiles.map((tile) => (
										<li key={tile.path}>
											<Link to={tile.path} className={styles.tile}>
												<span className={styles.tileName}>{tile.name}</span>
												<span className={styles.tileMeta}>{tile.meta}</span>
											</Link>
										</li>
									))}
								</ul>
							)}
						</section>
					))}
				</>
			)}
		</div>
	);
}

// Looks up the thing being viewed and gathers everything linked to it.
// Returns null if there's nothing with that id.
function getPage(
	kind: DetailProps["kind"],
	id: string | undefined,
	items: Item[],
	outfits: Outfit[],
	occasions: Occasion[],
): Page | null {
	if (kind === "item") {
		const item = items.find((each) => each.id === id);
		if (!item) {
			return null;
		}
		const itemOutfits = outfits.filter((outfit) => outfit.itemIds.includes(item.id));
		const itemOccasions = occasions.filter((occasion) =>
			itemOutfits.some((outfit) => occasion.outfitIds.includes(outfit.id)),
		);
		return {
			label: "Item",
			title: item.name,
			meta: item.type,
			groups: [
				{
					title: "Goes with",
					emptyMessage: "Not matched with anything yet.",
					tiles: items.filter((other) => item.compatibleIds.includes(other.id)).map(itemTile),
				},
				{
					title: "Outfits",
					emptyMessage: "Not in any outfits yet.",
					tiles: itemOutfits.map(outfitTile),
				},
				{
					title: "Occasions",
					emptyMessage: "Not part of any occasions yet.",
					tiles: itemOccasions.map(occasionTile),
				},
			],
		};
	}

	if (kind === "outfit") {
		const outfit = outfits.find((each) => each.id === id);
		if (!outfit) {
			return null;
		}
		return {
			label: "Outfit",
			title: outfit.name,
			meta: count(outfit.itemIds.length, "item"),
			groups: [
				{
					title: "Items",
					emptyMessage: "No items in this outfit.",
					tiles: items.filter((item) => outfit.itemIds.includes(item.id)).map(itemTile),
				},
				{
					title: "Occasions",
					emptyMessage: "Not part of any occasions yet.",
					tiles: occasions
						.filter((occasion) => occasion.outfitIds.includes(outfit.id))
						.map(occasionTile),
				},
			],
		};
	}

	const occasion = occasions.find((each) => each.id === id);
	if (!occasion) {
		return null;
	}
	const occasionOutfits = outfits.filter((outfit) => occasion.outfitIds.includes(outfit.id));
	return {
		label: "Occasion",
		title: occasion.name,
		meta: count(occasionOutfits.length, "outfit"),
		groups: [
			{
				title: "Outfits",
				emptyMessage: "No outfits for this occasion.",
				tiles: occasionOutfits.map(outfitTile),
			},
			{
				title: "Items",
				emptyMessage: "No items for this occasion.",
				tiles: items
					.filter((item) => occasionOutfits.some((outfit) => outfit.itemIds.includes(item.id)))
					.map(itemTile),
			},
		],
	};
}

function itemTile(item: Item): Tile {
	return { path: `/items/${item.id}`, name: item.name, meta: item.type };
}

function outfitTile(outfit: Outfit): Tile {
	return { path: `/outfits/${outfit.id}`, name: outfit.name, meta: count(outfit.itemIds.length, "item") };
}

function occasionTile(occasion: Occasion): Tile {
	return {
		path: `/occasions/${occasion.id}`,
		name: occasion.name,
		meta: count(occasion.outfitIds.length, "outfit"),
	};
}

// count(1, "item") → "1 item", count(3, "item") → "3 items"
function count(amount: number, word: string) {
	return `${amount} ${word}${amount === 1 ? "" : "s"}`;
}

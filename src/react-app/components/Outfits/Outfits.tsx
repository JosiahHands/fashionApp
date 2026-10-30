import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Item, Outfit } from "../../../shared/types";
import { EmptyState } from "../EmptyState/EmptyState";

type OutfitsProps = {
	items: Item[];
	outfits: Outfit[];
	// Resolves to true once saved, or false if it failed (App shows the error).
	onAdd: (name: string, itemIds: string[]) => Promise<boolean>;
	onRemove: (id: string) => void;
};

// Build outfits from saved items and see them listed.
export function Outfits({ items, outfits, onAdd, onRemove }: OutfitsProps) {
	const [name, setName] = useState("");
	const [pickedIds, setPickedIds] = useState<string[]>([]);

	// Skips any picked item that was removed before the outfit was saved.
	const picked = pickedIds.filter((id) => items.some((item) => item.id === id));
	const canSave = name.trim() !== "" && picked.length > 0;

	// True when the item is marked as going with every item picked so far.
	function goesWithPicks(item: Item) {
		return (
			picked.length > 0 &&
			!picked.includes(item.id) &&
			picked.every((id) => item.compatibleIds.includes(id))
		);
	}

	function togglePick(id: string) {
		setPickedIds(picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]);
	}

	function nameOf(id: string) {
		return items.find((item) => item.id === id)?.name;
	}

	// Only clears the form once it's saved, so nothing is lost if saving fails.
	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSave) {
			return;
		}
		if (await onAdd(name.trim(), picked)) {
			setName("");
			setPickedIds([]);
		}
	}

	return (
		<>
			<form className="form" onSubmit={handleSubmit}>
				<label className="field">
					<span className="label">Outfit name</span>
					<input
						type="text"
						value={name}
						placeholder="e.g. Weekend brunch"
						required
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<fieldset className="pills">
					<legend className="label">Items in this outfit</legend>
					<div className="pill-row">
						{items.map((item) => (
							<label key={item.id} className={goesWithPicks(item) ? "pill suggested" : "pill"}>
								<input
									type="checkbox"
									checked={picked.includes(item.id)}
									onChange={() => togglePick(item.id)}
								/>
								{item.name}
							</label>
						))}
					</div>
					{items.some(goesWithPicks) && (
						<p className="hint">Items with a dashed outline go with everything you've picked.</p>
					)}
				</fieldset>
				<button type="submit" disabled={!canSave}>
					Save outfit
				</button>
			</form>

			{outfits.length === 0 ? (
				<EmptyState message="No outfits saved yet." />
			) : (
				<ul className="cards">
					{outfits.map((outfit) => (
						<li key={outfit.id} className="card">
							<h3>
								<Link className="card-link" to={`/outfits/${outfit.id}`}>
									{outfit.name}
								</Link>
							</h3>
							<ul className="tags">
								{outfit.itemIds.map((id) => (
									<li key={id} className="tag">
										{nameOf(id)}
									</li>
								))}
							</ul>
							<button
								type="button"
								className="remove"
								aria-label={`Remove ${outfit.name}`}
								onClick={() => onRemove(outfit.id)}
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}
		</>
	);
}

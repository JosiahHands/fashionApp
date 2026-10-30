import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Occasion, Outfit } from "../../../shared/types";
import { EmptyState } from "../EmptyState/EmptyState";

type OccasionsProps = {
	outfits: Outfit[];
	occasions: Occasion[];
	// Resolves to true once saved, or false if it failed (App shows the error).
	onAdd: (name: string, outfitIds: string[]) => Promise<boolean>;
	onRemove: (id: string) => void;
};

// Group saved outfits into occasions and see them listed.
export function Occasions({ outfits, occasions, onAdd, onRemove }: OccasionsProps) {
	const [name, setName] = useState("");
	const [pickedIds, setPickedIds] = useState<string[]>([]);

	// Skips any picked outfit that was removed before the occasion was saved.
	const picked = pickedIds.filter((id) => outfits.some((outfit) => outfit.id === id));
	const canSave = name.trim() !== "" && picked.length > 0;

	function togglePick(id: string) {
		setPickedIds(picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]);
	}

	function nameOf(id: string) {
		return outfits.find((outfit) => outfit.id === id)?.name;
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
					<span className="label">Occasion or category</span>
					<input
						type="text"
						value={name}
						placeholder="e.g. Work, Date night, Summer"
						required
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<fieldset className="pills">
					<legend className="label">Outfits for this occasion</legend>
					<div className="pill-row">
						{outfits.map((outfit) => (
							<label key={outfit.id} className="pill">
								<input
									type="checkbox"
									checked={picked.includes(outfit.id)}
									onChange={() => togglePick(outfit.id)}
								/>
								{outfit.name}
							</label>
						))}
					</div>
				</fieldset>
				<button type="submit" disabled={!canSave}>
					Save occasion
				</button>
			</form>

			{occasions.length === 0 ? (
				<EmptyState message="No occasions saved yet." />
			) : (
				<ul className="cards">
					{occasions.map((occasion) => (
						<li key={occasion.id} className="card">
							<h3>
								<Link className="card-link" to={`/occasions/${occasion.id}`}>
									{occasion.name}
								</Link>
							</h3>
							<ul className="tags">
								{occasion.outfitIds.map((id) => (
									<li key={id} className="tag">
										{nameOf(id)}
									</li>
								))}
							</ul>
							<button
								type="button"
								className="remove"
								aria-label={`Remove ${occasion.name}`}
								onClick={() => onRemove(occasion.id)}
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

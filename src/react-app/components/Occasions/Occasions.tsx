import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { NAME_MAX_LENGTH, type Occasion, type Outfit } from "../../../shared/types";
import type { DragHandleProps } from "../App/App";
import { EmptyState } from "../EmptyState/EmptyState";

type OccasionsProps = {
	outfits: Outfit[];
	occasions: Occasion[];
	// Resolve to true once saved, or false if it failed (App shows the error).
	onAdd: (name: string, outfitIds: string[]) => Promise<boolean>;
	onUpdate: (id: string, name: string, outfitIds: string[]) => Promise<boolean>;
	onRemove: (id: string) => void;
	// Props for a card's drag handle, from App (which does the dragging).
	dragHandle: (id: string) => DragHandleProps;
};

// Group saved outfits into occasions, see them listed, and edit them.
export function Occasions({ outfits, occasions, onAdd, onUpdate, onRemove, dragHandle }: OccasionsProps) {
	const [name, setName] = useState("");
	const [pickedIds, setPickedIds] = useState<string[]>([]);
	// The occasion loaded into the form for editing, or null when the form adds a new one.
	const [editingId, setEditingId] = useState<string | null>(null);
	// True while saving, so a double click can't save twice.
	const [saving, setSaving] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);

	// If the occasion being edited gets deleted, the form goes back to adding a new one.
	const editing = occasions.find((occasion) => occasion.id === editingId);
	// Skips any picked outfit that was removed before the occasion was saved.
	const picked = pickedIds.filter((id) => outfits.some((outfit) => outfit.id === id));
	const canSave = name.trim() !== "" && picked.length > 0 && !saving;

	function togglePick(id: string) {
		setPickedIds(picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]);
	}

	function nameOf(id: string) {
		return outfits.find((outfit) => outfit.id === id)?.name;
	}

	// Loads the occasion into the form and scrolls up to it.
	function startEditing(occasion: Occasion) {
		setEditingId(occasion.id);
		setName(occasion.name);
		setPickedIds(occasion.outfitIds);
		formRef.current?.scrollIntoView();
	}

	function clearForm() {
		setEditingId(null);
		setName("");
		setPickedIds([]);
	}

	// Only clears the form once it's saved, so nothing is lost if saving fails.
	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSave) {
			return;
		}
		setSaving(true);
		const saved = editing
			? await onUpdate(editing.id, name.trim(), picked)
			: await onAdd(name.trim(), picked);
		setSaving(false);
		if (saved) {
			clearForm();
		}
	}

	return (
		<>
			<form ref={formRef} className="form" onSubmit={handleSubmit}>
				{editing && <p className="form-title">Editing “{editing.name}”</p>}
				<label className="field">
					<span className="label">Occasion or category</span>
					<input
						type="text"
						value={name}
						placeholder="e.g. Work, Date night, Summer"
						required
						maxLength={NAME_MAX_LENGTH}
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
				<div className="form-buttons">
					<button type="submit" disabled={!canSave}>
						{saving ? "Saving…" : editing ? "Save changes" : "Save occasion"}
					</button>
					{editing && (
						<button type="button" className="button" onClick={clearForm}>
							Cancel
						</button>
					)}
				</div>
			</form>

			{occasions.length === 0 ? (
				<EmptyState message="No occasions saved yet." />
			) : (
				<ul className="cards">
					{occasions.map((occasion) => (
						<li key={occasion.id} className="card" data-id={occasion.id}>
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
							<div className="card-actions">
								<button
									type="button"
									className="button"
									aria-label={`Edit ${occasion.name}`}
									onClick={() => startEditing(occasion)}
								>
									Edit
								</button>
							</div>
							{occasions.length > 1 && (
								<button
									type="button"
									className="drag-handle"
									aria-label={`Reorder ${occasion.name}`}
									title="Drag to move. Or use the arrow keys."
									{...dragHandle(occasion.id)}
								>
									⠿
								</button>
							)}
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

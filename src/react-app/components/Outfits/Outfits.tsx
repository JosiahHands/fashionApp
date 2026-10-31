import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { NAME_MAX_LENGTH, type Item, type Outfit } from "../../../shared/types";
import type { DragHandleProps } from "../App/App";
import { EmptyState } from "../EmptyState/EmptyState";

type OutfitsProps = {
	items: Item[];
	outfits: Outfit[];
	// Resolve to true once saved, or false if it failed (App shows the error).
	onAdd: (name: string, itemIds: string[]) => Promise<boolean>;
	onUpdate: (id: string, name: string, itemIds: string[]) => Promise<boolean>;
	onRemove: (id: string) => void;
	// Props for a card's drag handle, from App (which does the dragging).
	dragHandle: (id: string) => DragHandleProps;
};

// Build outfits from saved items, see them listed, and edit them.
export function Outfits({ items, outfits, onAdd, onUpdate, onRemove, dragHandle }: OutfitsProps) {
	const [name, setName] = useState("");
	const [pickedIds, setPickedIds] = useState<string[]>([]);
	// The outfit loaded into the form for editing, or null when the form adds a new one.
	const [editingId, setEditingId] = useState<string | null>(null);
	// True while saving, so a double click can't save twice.
	const [saving, setSaving] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);

	// If the outfit being edited gets deleted, the form goes back to adding a new one.
	const editing = outfits.find((outfit) => outfit.id === editingId);
	// Skips any picked item that was removed before the outfit was saved.
	const picked = pickedIds.filter((id) => items.some((item) => item.id === id));
	const canSave = name.trim() !== "" && picked.length > 0 && !saving;

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

	// Loads the outfit into the form and scrolls up to it.
	function startEditing(outfit: Outfit) {
		setEditingId(outfit.id);
		setName(outfit.name);
		setPickedIds(outfit.itemIds);
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
					<span className="label">Outfit name</span>
					<input
						type="text"
						value={name}
						placeholder="e.g. Weekend brunch"
						required
						maxLength={NAME_MAX_LENGTH}
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
				<div className="form-buttons">
					<button type="submit" disabled={!canSave}>
						{saving ? "Saving…" : editing ? "Save changes" : "Save outfit"}
					</button>
					{editing && (
						<button type="button" className="button" onClick={clearForm}>
							Cancel
						</button>
					)}
				</div>
			</form>

			{outfits.length === 0 ? (
				<EmptyState message="No outfits saved yet." />
			) : (
				<ul className="cards">
					{outfits.map((outfit) => (
						<li key={outfit.id} className="card" data-id={outfit.id}>
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
							<div className="card-actions">
								<button
									type="button"
									className="button"
									aria-label={`Edit ${outfit.name}`}
									onClick={() => startEditing(outfit)}
								>
									Edit
								</button>
							</div>
							{outfits.length > 1 && (
								<button
									type="button"
									className="drag-handle"
									aria-label={`Reorder ${outfit.name}`}
									title="Drag to move. Or use the arrow keys."
									{...dragHandle(outfit.id)}
								>
									⠿
								</button>
							)}
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

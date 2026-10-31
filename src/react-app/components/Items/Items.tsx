import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { itemTypes, NAME_MAX_LENGTH, type Item, type ItemType } from "../../../shared/types";
import { EmptyState } from "../EmptyState/EmptyState";

type ItemsProps = {
	items: Item[];
	// Resolves to true once saved, or false if it failed (App shows the error).
	onAdd: (name: string, type: ItemType) => Promise<boolean>;
	onToggleCompatible: (firstId: string, secondId: string) => Promise<void>;
	onRemove: (id: string) => void;
	// Moves an item one place earlier (-1) or later (+1) in the list.
	onMove: (id: string, step: number) => void;
};

// Add items, see them listed, and mark which ones go together.
export function Items({ items, onAdd, onToggleCompatible, onRemove, onMove }: ItemsProps) {
	const [name, setName] = useState("");
	const [type, setType] = useState<ItemType>("Top");
	const [selectedId, setSelectedId] = useState("");
	// True while saving, so a double click can't add the item twice.
	const [saving, setSaving] = useState(false);
	// The item whose "goes with" pill is being saved. Its pill is disabled until the server answers.
	const [pendingId, setPendingId] = useState<string | null>(null);

	// The item being matched up. Falls back to the first item if none is picked or it was removed.
	const selected = items.find((item) => item.id === selectedId) ?? items[0];
	const canSave = name.trim() !== "" && !saving;

	function nameOf(id: string) {
		return items.find((item) => item.id === id)?.name;
	}

	// Only clears the form once it's saved, so nothing typed is lost if saving fails.
	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSave) {
			return;
		}
		setSaving(true);
		const added = await onAdd(name.trim(), type);
		setSaving(false);
		if (added) {
			setName("");
			setType("Top");
		}
	}

	async function toggleCompatible(otherId: string) {
		setPendingId(otherId);
		await onToggleCompatible(selected.id, otherId);
		setPendingId(null);
	}

	return (
		<>
			<form className="form" onSubmit={handleSubmit}>
				<label className="field">
					<span className="label">Name</span>
					<input
						type="text"
						value={name}
						placeholder="e.g. White linen shirt"
						required
						maxLength={NAME_MAX_LENGTH}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<label className="field">
					<span className="label">Type</span>
					<select value={type} onChange={(event) => setType(event.target.value as ItemType)}>
						{itemTypes.map((itemType) => (
							<option key={itemType}>{itemType}</option>
						))}
					</select>
				</label>
				<button type="submit" disabled={!canSave}>
					{saving ? "Adding…" : "Add item"}
				</button>
			</form>

			{items.length === 0 ? (
				<EmptyState message="No items saved yet." />
			) : (
				<ul className="cards">
					{items.map((item, index) => (
						<li key={item.id} className="card">
							<h3>
								<Link className="card-link" to={`/items/${item.id}`}>
									{item.name}
								</Link>
							</h3>
							<p className="card-meta">{item.type}</p>
							{item.compatibleIds.length > 0 && (
								<>
									<p className="tags-label">Goes with</p>
									<ul className="tags">
										{item.compatibleIds.map((id) => (
											<li key={id} className="tag">
												{nameOf(id)}
											</li>
										))}
									</ul>
								</>
							)}
							{items.length > 1 && (
								<div className="card-actions">
									<button
										type="button"
										className="button"
										aria-label={`Move ${item.name} earlier`}
										disabled={index === 0}
										onClick={() => onMove(item.id, -1)}
									>
										←
									</button>
									<button
										type="button"
										className="button"
										aria-label={`Move ${item.name} later`}
										disabled={index === items.length - 1}
										onClick={() => onMove(item.id, 1)}
									>
										→
									</button>
								</div>
							)}
							<button
								type="button"
								className="remove"
								aria-label={`Remove ${item.name}`}
								onClick={() => onRemove(item.id)}
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}

			<h3 className="subheading">Compatibility</h3>
			{items.length > 1 ? (
				<div className="form">
					<label className="field">
						<span className="label">Item</span>
						<select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
							{items.map((item) => (
								<option key={item.id} value={item.id}>
									{item.name}
								</option>
							))}
						</select>
					</label>
					<fieldset className="pills">
						<legend className="label">Goes with {selected.name}</legend>
						<div className="pill-row">
							{items
								.filter((item) => item.id !== selected.id)
								.map((item) => (
									<label key={item.id} className="pill">
										<input
											type="checkbox"
											checked={selected.compatibleIds.includes(item.id)}
											disabled={pendingId === item.id}
											onChange={() => toggleCompatible(item.id)}
										/>
										{item.name}
									</label>
								))}
						</div>
					</fieldset>
				</div>
			) : (
				<EmptyState message="Add at least 2 items to set up compatibility." />
			)}
		</>
	);
}

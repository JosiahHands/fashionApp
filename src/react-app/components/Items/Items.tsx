import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { itemTypes, type Item, type ItemType } from "../../../shared/types";
import { EmptyState } from "../EmptyState/EmptyState";

type ItemsProps = {
	items: Item[];
	// Resolves to true once saved, or false if it failed (App shows the error).
	onAdd: (name: string, type: ItemType) => Promise<boolean>;
	onToggleCompatible: (firstId: string, secondId: string) => void;
	onRemove: (id: string) => void;
};

// Add items, see them listed, and mark which ones go together.
export function Items({ items, onAdd, onToggleCompatible, onRemove }: ItemsProps) {
	const [name, setName] = useState("");
	const [type, setType] = useState<ItemType>("Top");
	const [selectedId, setSelectedId] = useState("");

	// The item being matched up. Falls back to the first item if none is picked or it was removed.
	const selected = items.find((item) => item.id === selectedId) ?? items[0];

	function nameOf(id: string) {
		return items.find((item) => item.id === id)?.name;
	}

	// Only clears the name once it's saved, so nothing typed is lost if saving fails.
	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (name.trim() === "") {
			return;
		}
		if (await onAdd(name.trim(), type)) {
			setName("");
		}
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
				<button type="submit">Add item</button>
			</form>

			{items.length === 0 ? (
				<EmptyState message="No items saved yet." />
			) : (
				<ul className="cards">
					{items.map((item) => (
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
											onChange={() => onToggleCompatible(selected.id, item.id)}
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

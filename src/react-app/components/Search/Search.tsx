import { useState } from "react";
import { Link } from "react-router";
import type { Item } from "../../../shared/types";
import { EmptyState } from "../EmptyState/EmptyState";

type SearchProps = {
	items: Item[];
};

// Type part of an item's name to see what it goes with.
export function Search({ items }: SearchProps) {
	const [search, setSearch] = useState("");

	// Lowercase both sides so "shirt" finds "White Shirt".
	const query = search.trim().toLowerCase();
	const matches = items.filter((item) => item.name.toLowerCase().includes(query));

	function nameOf(id: string) {
		return items.find((item) => item.id === id)?.name;
	}

	return (
		<>
			<label className="field">
				<span className="label">Item name</span>
				<input
					type="search"
					value={search}
					placeholder="e.g. shirt"
					onChange={(event) => setSearch(event.target.value)}
				/>
			</label>

			{query !== "" &&
				(matches.length === 0 ? (
					<EmptyState message={`No items match "${search.trim()}".`} />
				) : (
					<ul className="cards">
						{matches.map((item) => (
							<li key={item.id} className="card">
								<h3>
									<Link className="card-link" to={`/items/${item.id}`}>
										{item.name}
									</Link>
								</h3>
								<p className="card-meta">{item.type}</p>
								<p className="tags-label">Goes with</p>
								{item.compatibleIds.length === 0 ? (
									<p className="card-meta">Nothing yet.</p>
								) : (
									<ul className="tags">
										{item.compatibleIds.map((id) => (
											<li key={id} className="tag">
												{nameOf(id)}
											</li>
										))}
									</ul>
								)}
							</li>
						))}
					</ul>
				))}
		</>
	);
}

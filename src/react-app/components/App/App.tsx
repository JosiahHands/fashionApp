import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router";
import type { Item, ItemType, Occasion, Outfit, User } from "../../../shared/types";
import * as api from "../../api";
import { Detail } from "../Detail/Detail";
import { EmptyState } from "../EmptyState/EmptyState";
import { Footer } from "../Footer/Footer";
import { Header } from "../Header/Header";
import { Hero } from "../Hero/Hero";
import { Items } from "../Items/Items";
import { Occasions } from "../Occasions/Occasions";
import { Outfits } from "../Outfits/Outfits";
import { Search } from "../Search/Search";
import { Section } from "../Section/Section";
import styles from "./App.module.css";

function App() {
	const navigate = useNavigate();
	// undefined while checking whether someone is already logged in (the cookie survives refreshes).
	const [user, setUser] = useState<User | null | undefined>(undefined);
	// False until the logged-in user's things have come back from the server.
	const [loaded, setLoaded] = useState(false);
	const [items, setItems] = useState<Item[]>([]);
	const [outfits, setOutfits] = useState<Outfit[]>([]);
	const [occasions, setOccasions] = useState<Occasion[]>([]);
	// Shown in a banner when a request fails.
	const [error, setError] = useState<string | null>(null);

	const isLoggedIn = Boolean(user);

	// On page load: is someone already logged in?
	useEffect(() => {
		api
			.getCurrentUser()
			.then(setUser)
			.catch((err: Error) => {
				setUser(null);
				setError(err.message);
			});
	}, []);

	// Once someone is logged in (on page load or by logging in), load their things.
	useEffect(() => {
		if (!isLoggedIn) {
			return;
		}
		// Ignores a slow response if the user logs out before it arrives.
		let ignore = false;
		api
			.loadWardrobe()
			.then((wardrobe) => {
				if (!ignore) {
					setItems(wardrobe.items);
					setOutfits(wardrobe.outfits);
					setOccasions(wardrobe.occasions);
					setLoaded(true);
				}
			})
			.catch((err: Error) => {
				if (!ignore) {
					setError(err.message);
				}
			});
		return () => {
			ignore = true;
		};
	}, [isLoggedIn]);

	// Clears everything that belongs to the user.
	function clearSession() {
		setUser(null);
		setItems([]);
		setOutfits([]);
		setOccasions([]);
		setLoaded(false);
	}

	// Shows what went wrong. A 401 means the session ran out, so the page shows as logged out.
	function showError(err: unknown) {
		if (err instanceof api.ApiError && err.status === 401) {
			clearSession();
			setError("You've been logged out. Log in again.");
			return;
		}
		setError((err as Error).message);
	}

	function logIn(loggedIn: User) {
		setError(null);
		setUser(loggedIn);
	}

	// Logs out on this page even if the server can't be told.
	async function logOut() {
		try {
			await api.logOut();
		} finally {
			clearSession();
			setError(null);
			navigate("/");
		}
	}

	// Deleting on the server can also delete outfits and occasions left empty, so reload them all.
	async function reload() {
		const wardrobe = await api.loadWardrobe();
		setItems(wardrobe.items);
		setOutfits(wardrobe.outfits);
		setOccasions(wardrobe.occasions);
	}

	// The add functions return true if it saved, so the form knows to clear itself.
	async function addItem(name: string, type: ItemType): Promise<boolean> {
		try {
			const item = await api.createItem(name, type);
			setItems((list) => [...list, item]);
			return true;
		} catch (err) {
			showError(err);
			return false;
		}
	}

	// Compatibility goes both ways, so both items are updated.
	async function toggleCompatible(firstId: string, secondId: string) {
		const first = items.find((item) => item.id === firstId);
		const compatible = !first?.compatibleIds.includes(secondId);
		try {
			await api.setCompatible(firstId, secondId, compatible);
			setItems((list) =>
				list.map((item) => {
					if (item.id === firstId) {
						return { ...item, compatibleIds: toggle(item.compatibleIds, secondId) };
					}
					if (item.id === secondId) {
						return { ...item, compatibleIds: toggle(item.compatibleIds, firstId) };
					}
					return item;
				}),
			);
		} catch (err) {
			showError(err);
		}
	}

	// The server also takes the item out of its outfits. Outfits left with no items are deleted too.
	async function removeItem(id: string) {
		const usedIn = outfits.filter((outfit) => outfit.itemIds.includes(id)).length;
		if (
			usedIn > 0 &&
			!window.confirm(
				`This item is in ${usedIn === 1 ? "1 outfit" : `${usedIn} outfits`}. Remove it anyway? Outfits left with no items will be deleted.`,
			)
		) {
			return;
		}
		try {
			await api.deleteItem(id);
			await reload();
		} catch (err) {
			showError(err);
		}
	}

	async function addOutfit(name: string, itemIds: string[]): Promise<boolean> {
		try {
			const outfit = await api.createOutfit(name, itemIds);
			setOutfits((list) => [...list, outfit]);
			return true;
		} catch (err) {
			showError(err);
			return false;
		}
	}

	// The server also takes the outfit out of its occasions. Occasions left with no outfits are deleted too.
	async function removeOutfit(id: string) {
		const usedIn = occasions.filter((occasion) => occasion.outfitIds.includes(id)).length;
		if (
			usedIn > 0 &&
			!window.confirm(
				`This outfit is in ${usedIn === 1 ? "1 occasion" : `${usedIn} occasions`}. Remove it anyway? Occasions left with no outfits will be deleted.`,
			)
		) {
			return;
		}
		try {
			await api.deleteOutfit(id);
			await reload();
		} catch (err) {
			showError(err);
		}
	}

	async function addOccasion(name: string, outfitIds: string[]): Promise<boolean> {
		try {
			const occasion = await api.createOccasion(name, outfitIds);
			setOccasions((list) => [...list, occasion]);
			return true;
		} catch (err) {
			showError(err);
			return false;
		}
	}

	async function removeOccasion(id: string) {
		try {
			await api.deleteOccasion(id);
			setOccasions((list) => list.filter((occasion) => occasion.id !== id));
		} catch (err) {
			showError(err);
		}
	}

	const home = (
		<>
			<Hero />
			<Section
				id="search"
				title="Search"
				description="Find an item and see what it goes with."
			>
				{items.length > 0 ? (
					<Search items={items} />
				) : (
					<EmptyState message="Add an item first to search your wardrobe." />
				)}
			</Section>
			<Section
				id="items"
				title="Items"
				description="Every piece in your wardrobe, and which ones go together."
			>
				<Items
					items={items}
					onAdd={addItem}
					onToggleCompatible={toggleCompatible}
					onRemove={removeItem}
				/>
			</Section>
			<Section
				id="outfits"
				title="Outfits"
				description="Complete looks built from your items."
			>
				{items.length > 0 ? (
					<Outfits
						items={items}
						outfits={outfits}
						onAdd={addOutfit}
						onRemove={removeOutfit}
					/>
				) : (
					<EmptyState message="Add an item first to start building outfits." />
				)}
			</Section>
			<Section
				id="occasions"
				title="Occasions"
				description="Outfits grouped by category or occasion."
			>
				{outfits.length > 0 ? (
					<Occasions
						outfits={outfits}
						occasions={occasions}
						onAdd={addOccasion}
						onRemove={removeOccasion}
					/>
				) : (
					<EmptyState message="Save an outfit first to set up occasions." />
				)}
			</Section>
		</>
	);

	// Everything a detail page needs to look things up by id.
	const saved = { items, outfits, occasions };

	// What the page shows depends on where the user is in logging in.
	let content;
	if (user === undefined) {
		content = <EmptyState message="Loading…" />;
	} else if (user === null) {
		// Nothing else can be used until the user logs in from the header.
		content = (
			<>
				<Hero />
				<EmptyState message="Log in or sign up to start saving your outfits." />
			</>
		);
	} else if (!loaded) {
		content = <EmptyState message="Loading your wardrobe…" />;
	} else {
		content = (
			<Routes>
				<Route path="/" element={home} />
				<Route path="/items/:id" element={<Detail kind="item" {...saved} />} />
				<Route path="/outfits/:id" element={<Detail kind="outfit" {...saved} />} />
				<Route path="/occasions/:id" element={<Detail kind="occasion" {...saved} />} />
				{/* Any other address goes back home. */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		);
	}

	return (
		<>
			<Header user={user} onLogIn={logIn} onLogOut={logOut} />
			<main className={styles.main}>
				{error && (
					<div className={styles.error} role="alert">
						<span>{error}</span>
						<button
							type="button"
							className={styles.dismiss}
							aria-label="Dismiss"
							onClick={() => setError(null)}
						>
							×
						</button>
					</div>
				)}
				{content}
			</main>
			<Footer />
		</>
	);
}

// Adds the id if it's missing, removes it if it's there.
function toggle(ids: string[], id: string) {
	return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

export default App;

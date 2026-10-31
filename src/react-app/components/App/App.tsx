import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router";
import type { Item, ItemType, Occasion, Outfit, User } from "../../../shared/types";
import * as api from "../../api";
import { Account } from "../Account/Account";
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

const LOGGED_OUT_MESSAGE = "You've been logged out. Log in again.";

// The lists whose cards can be dragged into a new order.
type ListName = "items" | "outfits" | "occasions";

// What a card's drag handle needs: drag it with a mouse, finger or pen, or focus it and use the arrow keys.
export type DragHandleProps = {
	onPointerDown: (event: PointerEvent<HTMLElement>) => void;
	onPointerMove: (event: PointerEvent<HTMLElement>) => void;
	onPointerUp: () => void;
	onPointerCancel: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	// "true" on the handle of the card being dragged, so CSS can show it.
	"data-dragging": boolean;
};

function App() {
	const navigate = useNavigate();
	const location = useLocation();
	// undefined while checking whether someone is already logged in (the cookie survives refreshes).
	const [user, setUser] = useState<User | null | undefined>(undefined);
	// False until the logged-in user's things have come back from the server.
	const [loaded, setLoaded] = useState(false);
	// True if loading them failed, so the page can offer to try again.
	const [loadFailed, setLoadFailed] = useState(false);
	// "Try again" adds one to this, which loads everything again.
	const [loadAttempt, setLoadAttempt] = useState(0);
	const [items, setItems] = useState<Item[]>([]);
	const [outfits, setOutfits] = useState<Outfit[]>([]);
	const [occasions, setOccasions] = useState<Occasion[]>([]);
	// Shown in a banner when a request fails.
	const [error, setError] = useState<string | null>(null);
	// Order saves wait for the one before, so a quick run of moves reaches the server in the right order.
	const orderSaves = useRef(Promise.resolve());
	// The card being dragged, and its list's order when the drag started (to tell if anything moved).
	const [dragging, setDragging] = useState<{ list: ListName; id: string; startOrder: string } | null>(null);

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
				if (ignore) {
					return;
				}
				// A 401 means the session ran out, so show the page as logged out.
				if (err instanceof api.ApiError && err.status === 401) {
					setUser(null);
					setError(LOGGED_OUT_MESSAGE);
					return;
				}
				setLoadFailed(true);
				setError(err.message);
			});
		return () => {
			ignore = true;
		};
	}, [isLoggedIn, loadAttempt]);

	// The header links go to sections of the home page, like "/#items". Scroll there once it's on screen.
	useEffect(() => {
		if (location.hash) {
			document.getElementById(location.hash.slice(1))?.scrollIntoView();
		}
	}, [location.key, location.hash, loaded]);

	// Clears everything that belongs to the user.
	function clearSession() {
		setUser(null);
		setItems([]);
		setOutfits([]);
		setOccasions([]);
		setLoaded(false);
		setLoadFailed(false);
	}

	// Shows what went wrong. A 401 means the session ran out, so the page shows as logged out.
	function showError(err: unknown) {
		if (err instanceof api.ApiError && err.status === 401) {
			clearSession();
			setError(LOGGED_OUT_MESSAGE);
			return;
		}
		setError((err as Error).message);
	}

	function tryLoadingAgain() {
		setLoadFailed(false);
		setError(null);
		setLoadAttempt((attempt) => attempt + 1);
	}

	function logIn(loggedIn: User) {
		setError(null);
		setUser(loggedIn);
	}

	// Only logs out on this page once the server has ended the session.
	// Otherwise the cookie would still work, and a refresh would log you straight back in.
	async function logOut() {
		try {
			await api.logOut();
			clearSession();
			setError(null);
			navigate("/");
		} catch (err) {
			showError(err);
		}
	}

	// The account and everything in it is gone on the server, so clear the page too.
	function accountDeleted() {
		clearSession();
		setError(null);
		navigate("/");
	}

	// Deleting on the server can also delete outfits and occasions left empty, so reload them all.
	async function reload() {
		const wardrobe = await api.loadWardrobe();
		setItems(wardrobe.items);
		setOutfits(wardrobe.outfits);
		setOccasions(wardrobe.occasions);
	}

	// Asks before deleting, listing everything else that goes with it. Returns true to go ahead.
	function confirmDelete(name: string, notes: string[]) {
		return window.confirm([`Delete "${name}"? This can't be undone.`, ...notes].join("\n\n"));
	}

	// Deletes on the server, then reloads. A 404 means it was already deleted (say, in another tab),
	// so that just reloads too.
	async function deleteThenReload(remove: () => Promise<void>) {
		try {
			await remove();
		} catch (err) {
			if (!(err instanceof api.ApiError && err.status === 404)) {
				showError(err);
				return;
			}
		}
		try {
			await reload();
			setError(null);
		} catch (err) {
			showError(err);
		}
	}

	// Saves a list's new order. If it fails, the error shows and the list goes back to the server's order.
	function saveOrder(list: ListName, ids: string[]) {
		orderSaves.current = orderSaves.current.then(async () => {
			try {
				await api.saveOrder(list, ids);
			} catch (err) {
				showError(err);
				// If this fails too, the error above is already showing.
				await reload().catch(() => {});
			}
		});
	}

	// The add and edit functions return true if it saved, so the form knows to clear itself.
	async function addItem(name: string, type: ItemType): Promise<boolean> {
		try {
			const item = await api.createItem(name, type);
			setItems((list) => [...list, item]);
			setError(null);
			return true;
		} catch (err) {
			showError(err);
			return false;
		}
	}

	// Compatibility goes both ways, so both items are updated.
	// Each one is set to the new state rather than flipped, so the screen always matches the server.
	async function toggleCompatible(firstId: string, secondId: string) {
		const first = items.find((item) => item.id === firstId);
		const compatible = !first?.compatibleIds.includes(secondId);
		try {
			await api.setCompatible(firstId, secondId, compatible);
			setItems((list) =>
				list.map((item) => {
					if (item.id === firstId) {
						return { ...item, compatibleIds: setIncluded(item.compatibleIds, secondId, compatible) };
					}
					if (item.id === secondId) {
						return { ...item, compatibleIds: setIncluded(item.compatibleIds, firstId, compatible) };
					}
					return item;
				}),
			);
			setError(null);
		} catch (err) {
			showError(err);
		}
	}

	// The server also takes the item out of its outfits, deletes outfits left with no items,
	// and then deletes occasions left with no outfits. The question lists all of that.
	async function removeItem(id: string) {
		const item = items.find((each) => each.id === id);
		if (!item) {
			return;
		}
		const usedIn = outfits.filter((outfit) => outfit.itemIds.includes(id));
		const emptied = usedIn.filter((outfit) => outfit.itemIds.length === 1);
		const kept = usedIn.filter((outfit) => outfit.itemIds.length > 1);
		const emptiedOccasions = occasions.filter((occasion) =>
			occasion.outfitIds.every((outfitId) => emptied.some((outfit) => outfit.id === outfitId)),
		);
		const notes = [];
		if (kept.length > 0) {
			notes.push(`It will be taken out of: ${quoted(kept)}.`);
		}
		if (emptied.length > 0) {
			notes.push(`These outfits will also be deleted, because they'd have no items left: ${quoted(emptied)}.`);
		}
		if (emptiedOccasions.length > 0) {
			notes.push(
				`These occasions will also be deleted, because they'd have no outfits left: ${quoted(emptiedOccasions)}.`,
			);
		}
		if (confirmDelete(item.name, notes)) {
			await deleteThenReload(() => api.deleteItem(id));
		}
	}

	async function addOutfit(name: string, itemIds: string[]): Promise<boolean> {
		try {
			const outfit = await api.createOutfit(name, itemIds);
			setOutfits((list) => [...list, outfit]);
			setError(null);
			return true;
		} catch (err) {
			showError(err);
			return false;
		}
	}

	async function updateOutfit(id: string, name: string, itemIds: string[]): Promise<boolean> {
		try {
			const outfit = await api.updateOutfit(id, name, itemIds);
			setOutfits((list) => list.map((each) => (each.id === id ? outfit : each)));
			setError(null);
			return true;
		} catch (err) {
			showError(err);
			return false;
		}
	}

	// The server also takes the outfit out of its occasions, and deletes occasions left with no outfits.
	async function removeOutfit(id: string) {
		const outfit = outfits.find((each) => each.id === id);
		if (!outfit) {
			return;
		}
		const usedIn = occasions.filter((occasion) => occasion.outfitIds.includes(id));
		const emptied = usedIn.filter((occasion) => occasion.outfitIds.length === 1);
		const kept = usedIn.filter((occasion) => occasion.outfitIds.length > 1);
		const notes = [];
		if (kept.length > 0) {
			notes.push(`It will be taken out of: ${quoted(kept)}.`);
		}
		if (emptied.length > 0) {
			notes.push(`These occasions will also be deleted, because they'd have no outfits left: ${quoted(emptied)}.`);
		}
		if (confirmDelete(outfit.name, notes)) {
			await deleteThenReload(() => api.deleteOutfit(id));
		}
	}

	async function addOccasion(name: string, outfitIds: string[]): Promise<boolean> {
		try {
			const occasion = await api.createOccasion(name, outfitIds);
			setOccasions((list) => [...list, occasion]);
			setError(null);
			return true;
		} catch (err) {
			showError(err);
			return false;
		}
	}

	async function updateOccasion(id: string, name: string, outfitIds: string[]): Promise<boolean> {
		try {
			const occasion = await api.updateOccasion(id, name, outfitIds);
			setOccasions((list) => list.map((each) => (each.id === id ? occasion : each)));
			setError(null);
			return true;
		} catch (err) {
			showError(err);
			return false;
		}
	}

	async function removeOccasion(id: string) {
		const occasion = occasions.find((each) => each.id === id);
		if (occasion && confirmDelete(occasion.name, ["Its outfits won't be deleted."])) {
			await deleteThenReload(() => api.deleteOccasion(id));
		}
	}

	// --- Drag and drop ---

	// Each list by name, for the drag and drop code below.
	const lists: Record<ListName, { id: string }[]> = { items, outfits, occasions };

	// Moves a card to a new place in its list, on screen only. Saving happens when the drag ends.
	function moveCard(list: ListName, id: string, toIndex: number) {
		if (list === "items") {
			setItems((cards) => moveInList(cards, id, toIndex));
		} else if (list === "outfits") {
			setOutfits((cards) => moveInList(cards, id, toIndex));
		} else {
			setOccasions((cards) => moveInList(cards, id, toIndex));
		}
	}

	// The props for one card's drag handle (the ⠿ button). While you drag, the card swaps places with
	// whichever card of the same list is under the pointer. Letting go saves the new order.
	function dragHandle(list: ListName, id: string): DragHandleProps {
		const ids = lists[list].map((card) => card.id);
		return {
			"data-dragging": dragging?.id === id,
			onPointerDown(event) {
				// Keeps sending this handle the pointer's moves, even once it's over other cards.
				event.currentTarget.setPointerCapture(event.pointerId);
				setDragging({ list, id, startOrder: ids.join() });
			},
			onPointerMove(event) {
				if (dragging?.id !== id) {
					return;
				}
				// Scrolls the page when dragging near the top or bottom of the screen.
				if (event.clientY < 120) {
					window.scrollBy(0, -12);
				} else if (event.clientY > window.innerHeight - 60) {
					window.scrollBy(0, 12);
				}
				// The card under the pointer, if it's in the same list (<ul>) as the one being dragged.
				const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("li[data-id]");
				if (over && over.dataset.id !== id && over.parentElement === event.currentTarget.closest("ul")) {
					moveCard(list, id, ids.indexOf(over.dataset.id!));
				}
			},
			onPointerUp: endDrag,
			// The browser took over the pointer (e.g. the phone's own gesture): keep the order so far.
			onPointerCancel: endDrag,
			onKeyDown(event) {
				const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
				const toIndex = ids.indexOf(id) + (step ?? 0);
				if (step === undefined || toIndex < 0 || toIndex >= ids.length) {
					return;
				}
				event.preventDefault();
				moveCard(list, id, toIndex);
				saveOrder(list, moveInList(lists[list], id, toIndex).map((card) => card.id));
			},
		};
	}

	// Saves the new order, if the drag changed it.
	function endDrag() {
		if (!dragging) {
			return;
		}
		const ids = lists[dragging.list].map((card) => card.id);
		if (ids.join() !== dragging.startOrder) {
			saveOrder(dragging.list, ids);
		}
		setDragging(null);
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
					dragHandle={(id) => dragHandle("items", id)}
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
						onUpdate={updateOutfit}
						onRemove={removeOutfit}
						dragHandle={(id) => dragHandle("outfits", id)}
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
						onUpdate={updateOccasion}
						onRemove={removeOccasion}
						dragHandle={(id) => dragHandle("occasions", id)}
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
	} else if (loadFailed) {
		content = (
			<div className={styles.page}>
				<EmptyState message="Your wardrobe couldn't be loaded." />
				<button type="button" className="button" onClick={tryLoadingAgain}>
					Try again
				</button>
			</div>
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
				<Route
					path="/account"
					element={<Account username={user.username} onLogOut={logOut} onDeleted={accountDeleted} />}
				/>
				<Route
					path="*"
					element={
						<div className={styles.page}>
							<h1 className={styles.notFound}>Page not found</h1>
							<EmptyState message="There's nothing at this address." />
							<Link to="/" className="button">
								← Home
							</Link>
						</div>
					}
				/>
			</Routes>
		);
	}

	return (
		<>
			<Header user={user} onLogIn={logIn} onLogOut={logOut} />
			<main className={styles.main}>
				{content}
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
			</main>
			<Footer />
		</>
	);
}

// Adds the id if it should be included and isn't, or removes it if it shouldn't be.
function setIncluded(ids: string[], id: string, included: boolean) {
	if (included) {
		return ids.includes(id) ? ids : [...ids, id];
	}
	return ids.filter((other) => other !== id);
}

// A copy of the list with one thing taken out and put back in at toIndex.
// moveInList([a, b, c, d], "a", 2) → [b, c, a, d]
function moveInList<T extends { id: string }>(list: T[], id: string, toIndex: number): T[] {
	const moving = list.find((thing) => thing.id === id);
	if (!moving) {
		return list;
	}
	const next = list.filter((thing) => thing.id !== id);
	next.splice(toIndex, 0, moving);
	return next;
}

// [{ name: "Brunch" }, { name: "Errands" }] → '"Brunch", "Errands"'
function quoted(things: { name: string }[]) {
	return things.map((thing) => `"${thing.name}"`).join(", ");
}

export default App;

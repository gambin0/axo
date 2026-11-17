# Hermit crab beach tank

Pet id: `crab`. Read [the shared notes](README.md) first.

> **Built** in `src/pets/crab/`. Differences from this plan:
> - The crab starts at size 2 in a size 1 shell, so it is cramped and the first thing to do is offer a shell, instead of a first moult 2 minutes in.
> - The shell is a drawn spiral, not a menu: the Shell tool offers one random shell near the crab's size (the first is always a fit). A crab only swaps when the new shell is clearly better, with a small taste for one pattern.
> - Food is one tool that fills the dish; wrong food is a Crisps tool that it sniffs and refuses.
> - A cramped crab grows at 40% speed, which nudges the kids to find a bigger shell.
> - Not built: the trust-gated shorter hide beyond the tap, the cholla wood, the cuttlebone, and per-food types.

## The idea

One hermit crab in a sandy tank. It grows by moulting, and each time it outgrows its shell the child offers new ones and the crab chooses. The shell swap is the event the kids wait for; day to day the crab is the most "tappable" pet in the app, because it ducks into its shell and peeks back out.

## Scene

Side view of a glass tank.

- Deep sand along the bottom (the crab digs into it), with a gentle slope.
- A shallow dish of fresh water and one of salt water, sunk into the sand.
- A food dish.
- A climbing branch or piece of cholla wood, and a half coconut hide.
- Spare shells lying on the sand, up to three at a time.
- Background: warm back wall, a little condensation on the glass when humid.

## The animal

Procedural body (legs need to animate): two big walking legs and a claw each side visible, eye stalks, antennae, soft abdomen hidden in the shell. The shell is a separate drawing so it can be swapped: a spiral drawn from a small set of shapes (turbo, whelk, moon snail) and patterns (plain, striped, spotted, painted).

Behaviours:

- **Walk** along the sand, **climb** the branch, **dig** a shallow pit.
- **Eat** from the dish, **drink** from either water dish.
- **Hide**: pulls into the shell when tapped, then eye stalks peek out after a moment. Gentle repeated taps get shorter hides as it learns to trust; frantic tapping makes it stay in longer.
- **Follow** a finger held on the glass, slowly.
- **Shell shop**: when offered a shell it walks over, inspects it (taps it, turns it), and either moves in or walks away.
- **Moult**: buries itself in the sand for a while, then emerges bigger and paler.
- Active at night; slow in the day.

## Needs

| Need | Falls | Restored by |
| --- | --- | --- |
| Fullness | over about 12 hours | Food in the dish |
| Thirst | over about 12 hours | Water dishes (must be kept topped up) |
| Humidity | over about 1.5 days | Mist tool |
| Shell fit | as the crab grows | A bigger shell |

Mood comes from the lowest need. A crab in a too-small shell looks cramped (body bulging out) and is grumpy until it gets a better one.

## Growth

- Size 1 to 6. Growth needs fullness and humidity above a threshold.
- Each size takes about 4 days, ending in a moult: about 12 hours buried (start the very first moult 2 minutes into the first session so a change is seen early, or begin with the crab already wanting a new shell).
- After a moult the crab's size goes up by one. If size is more than the shell's size, shell fit drops.
- **Shells**: the Shell tool drops one random shell of a size near the crab's (sometimes too small, sometimes too big). The crab accepts a shell if its size is within one of its own and prefers a closer fit; it has a mild random taste for pattern, so two crabs would not always pick the same one. Rejected shells stay until removed.
- At size 6 the crab is fully grown. Keep the loop alive with collectable shell patterns: it will still swap into a shell it likes better.

## Tools

Touch (default), Food (cycles a small menu: fruit, veg, shrimp pellet; honey as a treat), Water (tops up both dishes), Mist, Shell (offer a new one), Tidy (remove old food and rejected shells), Lamp.

Wrong food to teach with, like the ants' chocolate: salty crisps, rejected with a toast explaining why.

## Offline

- Eats and drinks from the dishes while there is something in them; dishes run down.
- Floors: fullness 15, thirst 15, humidity 25.
- A moult that comes due offline completes offline. A shell swap never happens offline: the crab waits, so the child always sees it.

## Neglect

Slow, hides more, stops growing. Never worse than that.

## Model sketch

```ts
interface Shell { id: number; size: number; shape: number; pattern: number; x: number }
interface CrabState {
  name: string;
  size: number; growth: number;        // growth 0..1 toward the next moult
  moult: number;                        // 0 when not moulting, else progress 0..1
  shell: Shell; spare: Shell[];
  fullness: number; thirst: number; humidity: number; trust: number;
  food: number; fresh: number; salt: number;   // dish levels
  x: number; y: number; state: string; timer: number;
  lamp: boolean; rng: number;
}
```

## Tests to write

Hunger and thirst rates; hiding and trust; accepts a fitting shell and rejects a bad one; moult raises size and takes the set time; no shell swap during catch-up; floors; nothing lost under total neglect; save round trip; determinism.

## Risk

The swap must read clearly at this scale. Plan a short close-up moment: the crab pauses beside the new shell, both are drawn side by side, then it hops across in three or four frames with a sparkle and a toast.

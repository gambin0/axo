# Beehive

Pet id: `bees`. Read [the shared notes](README.md) first.

> **Built** in `src/pets/bees/`. Differences from this plan:
> - Pet id is `bees`. The comb is 10 by 13 cells (130), drawn out from the middle, with stage caps of 12, 30, 60, 100 and 130 cells.
> - Foragers really carry one load from a flower to a cell when played live. When time is sped up or the app was closed, foraging is counted instead (daytime only). Both use the same flower and cell state.
> - A cell holds 4 loads, is fanned for a day, and becomes honey. Brood is exactly one day: 6 h egg, 12 h larva, 6 h capped.
> - Costs: a larva costs 0.4 cells of honey, each bee eats 0.04 cells a day, a new cell of comb costs 0.1. Unpaid honey debt blocks laying.
> - The garden sets the colony size: the queen stops laying at 12 bees plus 18 per blooming flower (six flowers allow the full 120). Below that limit the colony stops growing and stores honey, so a jar comes every couple of days with three or more flowers. A full garden reaches 120 bees in about 9 days.
> - Comb is drawn out when empty cells run short, and also whenever there is honey to spare, up to the stage's cap.
> - Flower refill: clover 1 load per 3 h, lavender per 4 h, sunflower per 8 h. Watering gives 1.5 times the refill and slows wilting.
> - The sugar feeder holds 4 loads and does not refill by itself.
> - The Honey tool is always tappable and refuses with a toast below the reserve (4 cells); a jar takes 4 cells.
> - Not built: individual bee roles changing over time, house bees fanning specific cells, and the queen's attendants.

## The idea

A glass-sided observation hive beside a small garden. Bees fly out to flowers the child plants, bring nectar back, and fill honeycomb cell by cell. The colony grows with the seasons of its own honey stores. It is the ant farm's sibling, so it must feel different: the ants are about digging down, the bees are about **flying out and building up**, and the child's main job is gardening.

## Scene

Split view.

- **Left two-fifths**: the hive in cross-section, a frame of hexagonal cells. Cells are empty, being drawn out in wax, holding an egg, a larva, capped brood, nectar (shiny), or capped honey (golden).
- **Right three-fifths**: a strip of garden with up to six flower spots, sky above, the hive entrance on the left edge of the garden.

Bees are about 6 by 5 pixels with a two-frame wing blur; the queen is longer. Show at most 50.

## The colony

Roles, as with the ants:

- **Foragers** fly a wobbly path to a flower with nectar, sit on it, fly home with full pollen baskets (yellow pixels on the legs), and pass nectar to a house bee.
- **House bees** store nectar in a cell, fan it, cap it as honey, feed larvae, and build new comb.
- **Queen** walks the brood area laying eggs.
- **Waggle dance**: a returning forager that found a rich flower does a short figure-of-eight on the comb, and more foragers head for that flower. This is the signature animation; make it obvious.
- **Guards** at the entrance. Tapping the entrance makes them come out and buzz.

## Economy

- **Flowers** are the food source. Each holds nectar that refills over a few hours and wilts after about 4 days. Different flowers give different amounts and bloom differently (clover: little and often; sunflower: lots, slow refill; lavender: steady).
- **Nectar** is carried to cells; several loads fill a cell; a full cell is capped as **honey** after about a day of fanning.
- **Honey** feeds the colony. The queen lays only when stores are above a threshold, as with the ants.
- **Brood**: egg (6 hours), larva (12 hours), capped (6 hours), then a new worker. Same compressed one-day cycle as the ants so both pets pace alike.
- **Comb** is built one cell at a time and costs honey. Comb size is the visible growth.

Stages by worker count, each unlocking a wider comb: Starter (8 bees, about 12 cells), Settling (20), Busy (45), Booming (80), Full hive (120, the whole frame).

Start with the queen, eight workers, a patch of comb, one flower already blooming and a forager on its way home, so the first nectar goes in within the first minute.

## The child's jobs

- **Plant** flowers and replace wilted ones. This is the main loop, and it is what makes the pet distinct from the ants.
- **Water** the flowers (they refill nectar faster and last longer).
- **Sugar water** feeder for bad days, a weaker stand-in for nectar.
- **Harvest**: when capped honey is plentiful, take a jar. Harvests are counted and shown as a shelf of jars; taking too much is refused with a toast ("the bees need that for themselves").
- **Tap**: bees near the tap gather; tap the entrance and the guards come out.

## Tools

Tap (default), Plant (cycles flower type), Water, Sugar water, Harvest (action, enabled when there is surplus), Lamp.

## Offline

- Foraging continues at a fixed rate from flowers that are alive; flowers wilt on schedule.
- Floors: honey never falls below a small reserve offline; the colony just stops laying.

## Neglect

No flowers means no nectar: the queen stops laying, bees cluster on the comb and move slowly. No bees are lost.

## Model sketch

```ts
type Cell = { kind: 'none' | 'wax' | 'egg' | 'larva' | 'capped' | 'nectar' | 'honey'; t: number };
interface Flower { kind: number; nectar: number; age: number; water: number }
interface HiveState {
  name: string;
  workers: number; stage: number; layAcc: number;
  cells: Cell[];                        // fixed hex grid; index maps to position
  flowers: (Flower | null)[];
  honeyJars: number; feeder: number;
  dance: { flower: number; ttl: number } | null;
  lamp: boolean; rng: number;
}
```

Honey and brood totals are derived by counting cells, so what the child sees is always exactly the state.

## Reuse

Agent tasks, role assignment and the "time-based progress, agents are the visible part of it" split come straight from `src/pets/ants/`. Bees fly in straight lines with a wobble, so no path graph is needed outside the hive; inside it, bees walk cell to cell.

## Tests to write

Foragers move nectar from flower to cell; cells cap into honey after the set time; laying needs honey; brood timeline; stage thresholds; comb only grows within the current stage; harvest refused below the reserve; dance draws more foragers to a flower; flowers wilt and refill; floors; no bees lost under neglect; save round trip; determinism.

## Risk

Overlap with the ant farm. Keep the garden as the focus of play and the comb as the reward. If time is short, cut guards and the sugar feeder, never the planting or the dance.

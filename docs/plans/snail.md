# Snail terrarium

Pet id: `snail`. Read [the shared notes](README.md) first.

> **Built** in `src/pets/snail/`. Differences from this plan:
> - Surfaces are the soil and the front glass only (no bark, plant or lid climbing). A snail pulls in briefly while it turns onto the glass.
> - Food is a mode tool: tap the soil to put down the next of lettuce, cucumber, carrot. Water is the Mist tool only (the dish is decoration).
> - Salt is an action that is refused with a toast. Nothing is harmed.
> - Not built: the morning "trail art" toast. Trails fade over two minutes and are not saved.
> - One name for the whole terrarium; snails are told apart by shell colour and bands.
> - Dry snails come home sealed after a long absence (floor 25 vs seal point 30), so a mist is the first thing to do.

## The idea

A calm, slow terrarium with a couple of garden snails. They glide over everything, including the glass, leaving silvery trails that fade. It is the easiest pet to build and the gentlest to look after, suited to the youngest child. Because it is quiet, it needs two things to hold interest: the trails (which the child can read like drawings) and baby snails.

## Scene

Side view of a planted glass box.

- Soil floor with moss, a piece of bark, a flat stone, a small plant or two.
- A shallow water dish and a food spot.
- A piece of cuttlebone (calcium) leaning in a corner.
- The front glass itself is a surface: snails climb it and are then drawn from underneath, showing the pale foot.

## The animal

Procedural, in the style of the caterpillar and tadpole.

- **Body**: a soft foot that stretches and bunches as it glides (a slow travelling wave), two long eye stalks and two short feelers that sway and retract.
- **Shell**: a spiral drawn from a growth value, so it visibly gains whorls. Colour and banding vary per snail (seeded), and children can tell their snails apart.
- **On the glass**: an underside view with a rippling foot and the mouth visible, which children find fascinating.

Behaviours:

- **Glide** to food, water, the cuttlebone, or just about. Speed is slow but not painful: about 6 pixels a second.
- **Eat**: rasps a visible notch out of a lettuce leaf or cucumber slice.
- **Retract**: tap a snail and it pulls into its shell; eye stalks creep back out one at a time.
- **Stalk poke**: tap near an eye stalk and just that stalk retracts.
- **Climb** the glass, the bark, the plant; sometimes hangs upside down from the lid.
- **Sleep**: sealed into the shell, stuck to the glass or tucked under bark. More active at night and when it is damp.
- **Trails**: a faint silvery line wherever it has been, fading over about two minutes. Store as a short list of points per snail, as the caterpillar trail does.

## Needs

| Need | Falls | Restored by |
| --- | --- | --- |
| Fullness | over about 14 hours | Lettuce, cucumber, carrot |
| Moisture | over about 1 day | Mist tool |
| Calcium | over about 3 days | Cuttlebone in the tank (replace when worn down) |

Dry snails seal up and stop moving until misted: this is the visible "needs care" state, and it reverses at once, which is satisfying.

## Slow processes

- **Shell growth**: each snail grows from baby to full size over about 3 weeks, needing calcium and food. New growth shows as a paler lip on the shell edge.
- **Eggs**: two well-kept adult snails lay a clutch of pearly eggs in the soil after a few days. They hatch in about 2 days into tiny, almost see-through babies. Cap the tank at six snails.

Start with two half-grown snails, one about to reach a fresh leaf, so eating is seen in the first minute.

## Tools

Touch (default), Food (cycles lettuce, cucumber, carrot), Mist, Cuttlebone (replace), Tidy (remove old food and droppings), Lamp.

Wrong thing to teach with: salt. It is refused outright with a clear toast ("Never give snails salt. It hurts them."). Nothing happens to the snails.

## Offline

- Eat from food left in the tank; food goes off after a day.
- Floors: fullness 15, moisture 25, calcium 15.
- Shell growth and egg timers continue while needs are above their thresholds.

## Neglect

Sealed up asleep, no growth. A mist and a leaf wakes them.

## Model sketch

```ts
interface Snail {
  id: number; growth: number; hue: number; bands: number;
  fullness: number; calcium: number;
  x: number; y: number;
  surface: 'floor' | 'glass' | 'bark' | 'lid';
  facing: 1 | -1; state: string; timer: number; tx: number; ty: number;
  hidden: number;                       // 0 out .. 1 fully retracted
}
interface TerrariumState {
  name: string;
  snails: Snail[]; nextId: number;
  eggs: { x: number; t: number } | null;
  foods: { x: number; kind: number; left: number; age: number }[];
  cuttlebone: number; moisture: number; droppings: number[];
  lamp: boolean; rng: number;
}
```

Movement: on the floor a snail follows the ground height; on the glass it moves freely in two dimensions. Changing surface happens at the walls and at the base of the bark.

## Tests to write

Hunger, moisture and calcium rates; a dry snail seals and wakes when misted; eats down a leaf; retract and re-emerge timing; shell growth needs calcium; eggs need two adults and respect the cap; salt is refused and harms nothing; floors; nothing lost under neglect; save round trip; determinism.

## Risk

Low excitement. Lean on what makes snails charming up close: the eye stalks, the underside on the glass, and the trails. If it still feels thin, add a "trail art" moment: after a busy night, the morning toast points out the pattern the snails drew.

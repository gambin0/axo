# Planned pets

Design plans for pets that are not built yet. Each one is written so it can be implemented on its own.

Built so far: axolotl, ants, butterfly, pond, the hermit crab and the snail terrarium (their plans are kept as a record of the design, with changes noted at the top).

| Plan | Hook for the kids | Effort | Main risk |
| --- | --- | --- | --- |
| [Hermit crab beach tank](hermit-crab.md) (built) | Offer new shells as it grows | Medium | Making the shell swap readable at pixel scale |
| [Hamster cage](hamster.md) | Cheek-stuffing, wheel, hoard | High | Fur and a round body in procedural art |
| [Beehive](beehive.md) | Plant flowers, fill honeycomb | Medium | Feeling too much like the ant farm |
| [Snail terrarium](snail.md) (built) | Slime trails, slow and calm | Low | Not exciting enough on its own |

Suggested order for what is left: beehive, hamster.

## How a pet plugs in

Every pet follows the same shape as the four that exist. Read one before starting; `src/pets/pond/` is the most recent and the cleanest example of a pet with several animals.

1. **`src/pets/<id>/model.ts`**: the simulation. No DOM and no drawing, so it runs in tests. It holds a plain serialisable state object, a seeded `Rng`, a config object with every tunable, and these methods:
   - `update(dt, slowDt, env)`: live step. `dt` moves animals; `slowDt` (dt times debug speed) drives needs and growth.
   - `coarseStep(dt, env)`: offline catch-up in one-minute steps. Needs and growth only, with safety floors.
   - `static load(raw, seed)` and `serialize()`.
   - Player actions as plain methods (`feed`, `tap`, ...) that push to an `fx` list instead of touching the UI.
2. **`src/pets/<id>/art.ts`**: drawing helpers that paint onto a `Surface` (`src/render/surface.ts`). Prefer procedural drawing for anything that bends or grows; use `makeSprite` string sprites for rigid shapes.
3. **`src/pets/<id>/<habitat>.ts`**: a class implementing `Habitat` (`src/pets/types.ts`). It owns the model, turns `fx` into particles, sounds and toasts, maps pointer input to model actions, and renders the scene. Cache anything static in a background `Surface`.
4. **Register it**: add the id to `PetId` in `src/pets/types.ts` and an entry to `PETS` in `src/main.ts`. Saving, catch-up, the home card, naming and reset then work with no other changes.
5. **Tests**: simulation tests beside `src/tests/sim-new.test.ts`, and a render test like `src/tests/snap-new.test.ts` (run with `SNAP_DIR=<folder>` to write PNGs and look at the art).

## Rules every pet keeps

- **Nothing dies.** Neglect slows growth or makes the pet look sad; care always brings it back. Each plan says what "neglected" looks like.
- **Offline floors.** During catch-up, needs stop at a floor so nobody returns to a disaster after a weekend away. Catch-up is capped at 72 hours.
- **Something happens in the first two minutes.** Start each pet just before its first event (an egg about to hatch, a first dig), so a child sees a change in the first session.
- **A reason to come back tomorrow.** Each pet has one slow process measured in days.
- **Every tap answers within a frame**, even if only with a ripple.
- **View is 320 by 180 art pixels.** Keep the main animal at least 30 pixels long; the first axolotl and butterfly drafts were both too small.
- **Night follows the real clock** (20:00 to 07:00), with a lamp or torch toggle for looking in after dark.

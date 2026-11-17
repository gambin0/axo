# Hamster cage

Pet id: `hamster`. Read [the shared notes](README.md) first.

> **Built** in `src/pets/hamster/`. Differences from this plan:
> - The art is procedural, not string sprites: each pose is a set of soft shaded ellipses (rump, body, head, snout, cheek pouch) with fur texture, a dark rim, a cream belly, ears, eyes and whiskers. Cheeks fill gradually and the pouch shows a crease; breathing, blinks and whisker twitches are built in. Poses: walk, sniff, sit, eat, groom, curl, run, dig. Four coats (golden, snowy, smoky, banded), picked at random.
> - The burrow is four dig jobs (entrance, nest, food store, back door; 8 days of work), carved into the bedding as tunnels the hamster really walks through. Offline digging goes at half speed, and only at night.
> - Trust is capped at 8 points a day, so it takes about two weeks. Unlocks: sniffs a finger at 15, sand bath at 20, takes treats by hand at 35, tube at 45, climbs on a finger at 60, sleeps in the open at 80. Neglect lets trust slip offline, never below half the best it reached.
> - Tools: Hand (tap, or hold a finger in the cage), Seeds, Treat (tap the tool again to cycle sunflower seed, carrot, apple, sweets), Water, Clean, Lamp. Seeds are stuffed and hoarded; carrot and apple are eaten on the spot; sweets are refused.
> - Hamsters are awake 18:00 to 08:00 and nap in the day, but a new hamster is awake for its first few minutes, and a tap wakes it for a couple of minutes.
> - Not built: a second level, more chew toys, and nest-building with pushed bedding (the nest is drawn with soft bedding instead).

## The idea

A hamster in a cut-away cage. It is the cuddliest pet in the app and the one with the most personality: it stuffs its cheeks, carries food to a hoard, runs on its wheel and builds a nest. The slow process is the hamster getting tamer and its burrow growing.

## Scene

Side view, cut through the bedding so tunnels show (the ant-farm trick).

- Deep bedding in the lower third, with tunnels and a nest chamber the hamster digs out over days.
- Above the bedding: wheel, water bottle on the wall, food bowl, a little house, a chew toy, a cardboard tube.
- A sand bath dish.
- Wire or glass front, room wall behind.

## The animal

This is the hard part. A round furry body does not suit the spine-and-profile approach used for the axolotl. Recommended approach:

- A small set of **hand-drawn string sprites** for the key poses (about 24 by 16 pixels): walk (4 frames), sit up, groom (2), run in wheel (4), sleep curled, dig (2), stuffed-cheeks variants of walk and sit.
- **Palette swap** for coat colours: golden, white, grey, cream banded.
- A one-pixel procedural breathing bob and whisker twitch so it never looks frozen.

Budget real time for drawing and checking these with the snapshot test; expect several passes.

Behaviours:

- **Forage**: goes to the bowl or a dropped treat, stuffs cheeks (cheek sprites), carries food to the hoard in the burrow, empties cheeks there.
- **Wheel**: runs in bursts, mostly in the evening and at night. The wheel spins and squeaks.
- **Burrow**: digs tunnels a little each day; pushes bedding into a nest.
- **Groom**, **sand bath roll**, **chew**, **drink** from the bottle.
- **Sleep** in the nest through the day. Tapping wakes it; it is sleepy and slow for a moment.
- **Hand**: a finger held in the cage brings it over to sniff. With trust it climbs on and takes a treat from the finger.

## Needs

| Need | Falls | Restored by |
| --- | --- | --- |
| Fullness | over about 10 hours | Eating from the bowl or hoard |
| Water | bottle empties over 2 days | Refill tool |
| Energy to burn | builds while awake | Wheel, exploring |
| Cleanliness | droppings and old food | Spot-clean tool |
| Trust | starts low | Gentle interaction, treats by hand |

The hoard is the food store: the hamster eats from it when the bowl is empty, which also covers time offline.

## Slow processes

- **Trust**, 0 to 100 over about two weeks of daily visits. Unlocks: comes to the finger, takes treats by hand, climbs on, falls asleep in view rather than hidden.
- **Burrow**, dug along a fixed blueprint like the ants' nest, a few pixels a day, finishing in about 10 days: entrance tunnel, nest chamber, food store, a second exit.
- **Unlocks** by trust and days of care: tube, second level, sand bath, new chew toys.

Start the first session with the hamster awake and about to find a treat, so cheek-stuffing is seen in the first minute.

## Tools

Hand (default), Seeds (fills the bowl), Treat (sunflower seed, carrot, a bit of apple; dropped where tapped or offered on the finger), Water (refill), Clean, Lamp, and decoration toggles as they unlock.

Wrong food to teach with: chocolate or sweets, rejected with a toast.

## Offline

- Eats from the bowl, then the hoard; bottle runs down.
- Floors: fullness 15; water never fully empties.
- Burrow digging and trust do not advance offline beyond a small amount: trust needs the child there.

## Neglect

Stays hidden in the nest, a bit grumpy, trust slips back slowly (never below a floor of half what was earned). Comes round again with a few treats.

## Model sketch

```ts
interface HamsterState {
  name: string; coat: number;
  fullness: number; energy: number; trust: number; cleanliness: number;
  cheeks: number;                       // food carried, 0..3
  bowl: number; hoard: number; bottle: number;
  dug: number[];                        // burrow job progress, as in the ant farm
  droppings: { x: number; y: number }[];
  x: number; y: number; node: number; path: { x: number; y: number }[];
  state: string; timer: number;
  unlocked: string[]; lamp: boolean; rng: number;
}
```

Movement can reuse the ant farm's approach: a small graph of nodes (bowl, wheel, bottle, house, burrow entrance, nest, hoard) with walking paths between them.

## Tests to write

Cheek-stuff and hoard cycle moves food from bowl to hoard; eats the hoard when the bowl is empty; wheel only when energy is high; nocturnal schedule; trust gates the hand behaviours and has a floor; burrow reaches full over the set time; floors; nothing lost under neglect; save round trip; determinism.

## Risk

Art. If the sprites do not read as a hamster, the pet fails regardless of the simulation. Draw the sit-up and stuffed-cheek poses first and judge them before building anything else.

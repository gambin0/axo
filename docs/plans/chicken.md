# Chicken coop

Pet id: `chicken`. Read [the shared notes](README.md) first.

> **Built** in `src/pets/chicken/`. This page records the design as built.

## The idea

An egg in warm straw hatches in the first visit. The chick grows into a gangly pullet and then a hen, who lays an egg most days for the child to collect. The slow processes are growing up (about a week) and the egg basket after that.

## Scene

A backyard run, seen from the side. The sky follows the real clock: the sun crosses it by day, the sky turns pink at dawn and dusk, and the moon and stars come out at night, with clouds drifting by. There are hazy hills with a far-off barn, an apple tree, sunflowers over a post-and-wire fence, and a dirt path worn through the grass.

- **Heat lamp corner** (left): a lamp on a post over a straw bed. It is only there while there is a chick.
- **Feeder and drinker**: a metal feeder whose tray shows the corn left, and a clear drinker whose water level shows.
- **Dust bath**: a hollow of dry dirt.
- **Swing**: appears when friendship unlocks it.
- **Hen house**: red walls, a slate roof, standing on legs with a ramp up to the door. The front is cut away to show a perch, a window and a nest box. A lantern under the eave is the Light toggle.

## The animal

Procedural, like the hamster. It is built from soft shaded ellipses (body, breast, neck, head, wing and tail, some of them rotated), and one `grow` value (0..1) morphs it from a round ball of down with a big head into a hen with a comb, wattles and a fanned tail. A chick's outline is fuzzy, and a youngster's feathers come in patchily. Poses: stand, walk, peck, scratch, sit, sleep, flap, cheep, dust.

Five breeds, picked when it is named or later from Settings. Each has its own chick down and adult plumage: Snowy (yellow, then white), Ginger (buff, then orange), Chestnut (striped brown, then mahogany with a dark tail), Midnight (black, then black with a green sheen) and Speckles (grey, then barred). The egg colour depends on the breed.

## Growing up

| Stage | Days | Notes |
| --- | --- | --- |
| Egg | first 30 s | Wobbles and cracks; tapping it makes it hatch sooner |
| Chick | 0–3 | Gets cold away from the lamp (about 90 s) and runs back; sleeps under the lamp |
| Pullet | 3–7 | Feathers come in, the comb starts to show; the lamp goes and it roosts in the coop |
| Hen | 7+ | Lays an egg about every 22 h when fed; the first one comes 2 minutes after she grows up |

Growth runs at 30% speed when it is hungry or out of water. It never goes backwards.

## Needs and friendship

Tummy (feeder, about 10 h), water (2 days), and clean (droppings every 2 h by day, plus old treats). Friendship is capped at 8 points a day. It unlocks treats from the hand at 15, the swing at 30, and hopping onto a finger held still at 50. Chicks follow a finger held in the run from the start.

## The flock

The first hen's eggs can hatch, so the coop grows into a flock of up to **4 birds** (eggs being kept warm count towards the four).

- **Hatch tool** (🥚, shown once there is a hen): moves an egg from the nest box into the warm straw under the heat lamp. It hatches in about **12 hours**. Refused with a toast when the nest is empty or the run is full.
- **Broody hens**: when a hen lays and there is room, there is a 1 in 5 chance she goes broody instead. She sits on the egg in the nest box for 12 hours, only getting off for a quick bite, and lays nothing meanwhile. The chick hatches in the nest box and walks down to the lamp.
- **Hatching is always seen**: an egg that finishes warming while the app is closed waits 20 seconds after the child comes back, then hatches.
- **Names**: the child is asked to name each new chick as soon as it hatches. Tapping away keeps a suggested name (Pip, Nugget, Peep and so on). Settings still renames only the first bird.
- A chick takes its mother's breed. Friendship is shared by the whole flock. Each bird has its own tummy, warmth and growth.
- The feeder holds 4 more portions for each bird after the first. Water and droppings scale with the flock's appetite, where a chick counts for less than a hen.
- At night the hens sit side by side on the perch and the chicks huddle under the lamp. Only one bird uses the swing or hops onto a finger at a time, and two birds never chase the same last bite.
- Saves from before the flock load as a flock of one.

## Tools

Hand, Corn (fills the feeder, or scatters 5 kernels elsewhere), Worm (always first choice), Lettuce, Chocolate (refused, to teach that it is bad for chickens), Water, Clean, Hatch (once there is a hen) and Light.

## Offline

It eats from the feeder, with floors on fullness (15) and water. An egg left alone gets ready and hatches 20 seconds after the child returns. A hen lays by day, up to 3 eggs in the nest box, and may go broody. Neglect lets friendship slip, never below half its best.

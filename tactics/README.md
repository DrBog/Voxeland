# IRONWAKE

A Fire-Emblem-shaped tactics game in a real 3D arena, where the arithmetic
decides *whether* a blow lands and the physics decides *what it does*.

Open `dist/ironwake.html` — one file, no build step, no dependencies. It is
built for a phone held in one hand.

## The idea

Grid tactics settles a fight with a table: attack minus defence, a hit roll,
a number leaves a health bar. That part is here in full — the weapon triangle,
2RN hit rates, doubling on attack speed, terrain avoid and defence, growth
rolls on level-up.

What is not from a table is everything after the hit. Every unit is an active
ragdoll: seventeen mass points held up by muscles that are force-limited
velocity drives, standing and walking under their own control. A unit is
pose-driven only while it is in charge of itself. The moment it is struck, the
muscles lose the argument and the body is the solver's — it staggers, it goes
down, it gets back up, or it goes over the side of the bridge and the arena
keeps it. Nothing in that sequence is an animation.

A unit walks in its own frame — a heading it turns toward, a forward and a
sideways derived from that heading — and while a foot is on the ground it is
pinned to the world and the hips are carried over it. Both of those are load
bearing: build a stance on world axes and a unit walking east faces the camera
and slides; let a muscle try to hold the plant instead of pinning it and the
leg bone drags the foot along at four fifths of walking pace, which is a body
being pushed, not a body walking.

The arena is genuinely multi-level, because a tile is a *column* of walkable
surfaces rather than a height: a bridge crosses over a courtyard and units
stand on either. Movement is Dijkstra over surfaces with climb and drop limits
and a headroom check, so a two-storey roof has to be taken by the stairs, and
high ground is worth taking — it adds to hit and to damage.

Every wave after the first is fought on new ground. Maps are built rather than
drawn: a kit of operations (ground, block, span, stairway, pit) and four
archetypes that compose them — a courtyard, a rift, a keep, two towers and the
walkway between them. A stairway lays whatever rise keeps each step inside the
climb limit, so a route the kit builds is walkable in both directions by
construction. Nothing reaches the player unchecked: both lines placed, every
spawn and every held position connected, three real heights, six tiles you can
be knocked off, and enough ground between the lines for a first turn. A map
that fails any of those is rerolled, and the last wave's ground sits out of the
next draw.

Survivors carry their levels into the next wave. The fallen do not come back.

## Playing it

- **Tap** one of yours, then a blue tile to move — or tap an enemy to propose
  the attack. The forecast shows the exchange from where you *would* be
  standing; STRIKE commits, anything else cancels.
- Tap one of theirs with nothing selected to see what it can reach next turn.
- **Drag** moves the camera, **pinch** zooms, two fingers swing it around, and
  ⤢ snaps between the whole board and the fight. Left alone it frames itself:
  the board when you are thinking, the unit when you pick one up, the two of
  them when a blow lands.
- Tap your own unit again to hold its ground, WAIT to end its turn.

## Layout

| file | what it is |
| --- | --- |
| `src/00-util.js` | maths, seeded rng, formatting |
| `src/01-physics.js` | 3D Verlet solver: bones, hinges, muscle drives, contacts |
| `src/02-ragdoll.js` | the 17-point humanoid and its limb controllers |
| `src/03-grid.js` | the arena as columns of surfaces; movement graph; collider |
| `src/04-units.js` | classes, weapons, and the arithmetic of a duel |
| `src/05-actor.js` | pose, march, swing — and the handover to physics on a hit |
| `src/06-battle.js` | turns, the action queue, enemy AI |
| `src/07-campaign.js` | the run: survivors, recruits, waves, the save |
| `src/08-render.js` | software 3D renderer in canvas2d |
| `src/09-audio.js` | synthesised sound, off until asked |
| `src/10-ui.js` | the readable half: cards, forecast, log |
| `src/11-main.js` | boot, fixed-step loop, camera, tap picking |

```
node build.mjs                    # bundle to dist/
node --test test/battle.test.mjs  # arena, combat, bodies, campaign
```

The tests run the real modules in a node sandbox and play whole battles
headlessly, including the ones that check a body can be knocked off the bridge
and that nothing ends a turn standing in someone else's tile.

# KINESIS

*An idle parkour runner with a real body.*

A 3D endless sprinter where **nothing is animated**. The runner is an active
ragdoll — seventeen point masses, eleven bones, six hinges, about 72 kg — and
every stride, stumble, catch and collapse is the physics solving in real time.
You never steer. You train the body, and the body takes the route.

Open `dist/kinesis.html` in any browser, or `index.html` for the unbundled
source. No build step needed to play, no dependencies anywhere.

```
node build.mjs          # bundle src/ + style.css into dist/
node --test test/       # 9 tests: economy, world invariants, and the gait itself
```

## The idea

Idle games are loops: numbers go up until a milestone falls. The number here
is distance, and the milestone is a **gate** — a piece of geometry sized so
that the stat it names is the stat that clears it. THE JUNCTION is a six-lane
cut with nothing under it; you clear it when LEG DRIVE can actually throw the
body that far, not when a counter says 5. Nothing checks a number and waves
you through.

## How the runner works

Three layers, and only the top one knows about the game.

**`01-physics.js` — the solver.** Verlet integration in metres and seconds.
Bones are distance constraints; joints are hinges that hold a plane and clamp
a fold. Muscles are neither: a muscle asks for a *velocity* toward a target
and may change the point's real velocity by at most `accel` per second. That
ceiling is what upgrades buy and what injuries take away — a weak muscle
loses to gravity, which is the entire reason a hurt runner folds instead of
playing a "hurt" animation.

Two details took most of the debugging and are worth knowing:

- Joint limits correct position *and* previous position. In Verlet a
  positional correction is indistinguishable from velocity, so limits that
  correct naively pump energy into the skeleton until it launches itself into
  orbit. Limits are structure, not muscle, and must be silent.
- Contact has a 3.5 cm skin. A foot resting a few millimetres proud of a deck
  is standing on it; without the skin, contact flickers on and off at 180 Hz
  and the support leg spends half its life believing it is airborne.

**`02-ragdoll.js` / `03-euphoria.js` — the behaviour stack.** Layered lowest
priority first: gait → balance → steer → stagger → protect → catch → get up.
Each behaviour only ever asks for world-space targets. Whether the body
delivers is up to the solver, the muscle ceiling, and consciousness. That gap
between intent and result is where everything interesting lives; the same hit
at the same speed can end four different ways.

The gait is a foot-placement controller, not a cycle. Where the next foot
lands is decided by the neutral point — where the mass will be by the time the
foot arrives — clamped to what the leg can actually reach, which is
`sqrt(L² - h²)` and no further. Ask for more and the runner over-strides into
the splits, exactly as a person does when they try to out-run their own legs.
Support is a hip-height servo over the planted foot with gravity fed forward,
because a straight leg carries no load along its own axis: without the servo
the hip just rides an arc into the deck as the body vaults over it.

**`05-ai.js` — the decision layer.** Deliberately thin. It reads the deck
ahead, picks a line and a take-off, and gets out of the way. REFLEX buys
lookahead distance and timing precision; everything it gets wrong is handed
straight to the behaviour stack. Take-off intent is buffered across the flight
phase, because the moment you decide to jump is usually a moment with no foot
on the ground.

## The route

Seven districts, each changing the physics rather than the palette: the glass
of GLASSWORKS is genuinely slippery (Coulomb friction, low µ), the crosswind
on the UPPER SPINE is a real lateral force on every point of the body, and the
deck narrows to something you can fall off. Gaps are sized against the legs
that have to clear them — an idle runner that meets an unjumpable hole farms
the same forty metres forever, and that is not a game, it is a wall.

## Rendering

`08-render.js` is a small software 3D renderer on canvas2d: perspective
projection, near-plane clipping, painter's sort, distance fog. No WebGL and no
library — the scene is a few dozen boxes and one body, which canvas draws
comfortably at 60 fps on a phone. Every readable character is DOM, so text
stays sharp; the canvas draws only the world.

## Files

| | |
|---|---|
| `src/00-util.js` | rng, easing, number formatting |
| `src/01-physics.js` | verlet solver, hinges, muscles, collision |
| `src/02-ragdoll.js` | the body: bones, IK, support servo |
| `src/03-euphoria.js` | the behaviour stack |
| `src/04-world.js` | districts, gates, procedural route |
| `src/05-ai.js` | line choice, take-offs, ducking |
| `src/06-progression.js` | upgrades, momentum, prestige, offline |
| `src/07-game.js` | run lifecycle, camera, particles |
| `src/08-render.js` | software 3D renderer |
| `src/09-audio.js` | synthesised sound, off by default |
| `src/10-ui.js` | HUD and panels |
| `src/11-main.js` | boot, loop, save |

Save data lives in `localStorage` under `kinesis.save.v1`.

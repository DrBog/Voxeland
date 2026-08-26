# VOXELAND

*The city stopped breathing. You didn't.*

A grim voxel zombie-survival game for Android, written in Kotlin on raw
OpenGL ES 3.0 — no game engine. Think blocky urban horror in the spirit of
Unturned: one large dead city, realism-leaning survival, and the dark makes
them bold.

## What's in v0.2.1

- **Voxel engine** — chunked streaming world, face-culled meshing on worker
  threads, procedurally painted texture atlas (every material is synthesized;
  the desaturated palette *is* the art direction), distance fog.
- **Atmosphere / horror lighting**
  - *Propagated sky light*: a flood fill carries daylight in through windows
    and doorways and attenuates with depth, so a room is bright at the glass
    and black at the back wall. Player-built roofs darken their own interiors.
  - *Eye adaptation*: the pupil contracts in about half a second but dark
    adaptation takes several — step in from daylight and you are genuinely
    blind for a beat before shapes resolve.
  - *Light shafts and dust*: beams are baked at openings pointing into their
    rooms; the shader burns each one according to the live sun bearing, so
    they swing and die as the day turns. Drifting dust motes sample the same
    propagated light, catching fire inside a beam and vanishing outside it.
  - *Scotopic vision*: colour drains toward blue-grey at low luminance.
  - *Two lights*: you wake with a **shake torch** — a wind-up dynamo that
    runs 60% less than a battery flashlight (2:48 against 7:00) and throws a
    dimmer cone, but never dies for good: shake the handset or hold LMP to
    wind it. A found **flashlight** is a real upgrade, and burns batteries.
    Both light the dust in front of them.
  - 62° base FOV (56° crouched, 68° sprinting) for a tighter, closer frame.
- **One large city, 100 building variants** — a component builder system
  assembles every structure from archetype × wall material × roof style ×
  window style × floor count × interior function. Gate logic is enforced in
  code (`Archetype.permits`): a house can never wear a skyscraper's tower
  cap, a skyscraper can never start as a factory. The catalog locks to
  exactly 100 legal variants (unit-tested). Districts: downtown towers,
  a commercial ring, suburbs, an industrial sector, and wasteland beyond.
- **48-minute full day/night cycle** — every environmental effect is a
  continuous function of the sun: long twilights, blood-dusk skies, heavy
  dawn fog, time-varying wind, and zombie aggression that scales with
  darkness rather than flipping at a boundary.
- **Survival realism** — health, hunger, thirst, stamina, infection from
  bites (find antibiotics), fall damage, permadeath. Vitals drain faster
  when you sprint.
- **Character creation (fresh saves)** — name, build, skin, hair, and a
  past life (Mechanic / Paramedic / Scout / Cook), each with real gameplay
  modifiers and starting gear.
- **Inventory & crafting** — 5-slot hotbar + expandable backpack, container
  looting driven by building function (pharmacies hold medicine, hardware
  stores hold nails), 12 recipes, some skill-gated.
- **Leveling trees** — Survival / Scavenging / Endurance. Unlock the
  compass (crafted from a dead man's watch — the HUD gains a bearing
  ribbon), deeper pockets (+inventory rows), silent steps, and more.
- **HUD** — one intuitive pass: left thumb joystick (push past the rim to
  sprint), right thumb look, ATK/USE/JMP cluster, tap-select hotbar,
  vitals bars, clock, XP, mining ring, damage and infection vignettes.
- **All audio procedurally generated** (`tools/gen_assets.py`) — wind beds,
  city rumble with distant metal creaks, night drones, interior settling,
  zombie vocals synthesized from filtered noise and detuned harmonics,
  footsteps, heartbeat. **No music** — composition is deliberately left
  open for original scoring.

## Build

Requires JDK 17+, Android SDK (platform 34). Sounds/icons are committed;
regenerate with `python3 tools/gen_assets.py` (needs numpy).

```
./gradlew assembleRelease   # or assembleDebug
./gradlew test              # generation + headless simulation tests
```

APK lands in `app/build/outputs/apk/`. Sideload onto any arm64 Android 8+
device (enable "install unknown apps").

## Controls

| Input | Action |
|---|---|
| Left thumb | Move (push far up = sprint) |
| Right thumb drag | Look |
| ATK (hold) | Attack / mine the targeted block |
| USE | Search container in view, else eat/drink/heal/place held item |
| JMP / CRC | Jump / crouch (crouching hides you) |
| LMP tap | Toggle the light in hand |
| LMP hold | Wind the shake torch |
| Shake handset | Wind the shake torch |
| BAG / SKL | Backpack + crafting / skill trees |
| Hotbar tap | Select slot |

## Architecture map

```
core/     Blocks, World+Chunk, Environment (48-min day), LightEngine (sky
          propagation), EyeAdaptation, LightSource (torch kinds), Rng
gen/      BuildingSystem (components + gate logic + 100-variant catalog),
          CityGen (districts, roads, lots, Blueprint block function)
gl/       Shader, TextureAtlas, ChunkMesher, Raycast, GameRenderer
entity/   Player (vitals + AABB physics), Zombie (wander/chase/attack)
items/    Items, Inventory, Recipes, Loot tables
progression/  Skills (3 trees), Character (CAC data + modifiers)
audio/    SoundManager (SoundPool sfx + cross-mixed ambient beds)
save/     JSON save: world edits, looted set, player, clock
ui/       GameHud (HUD + touch), Panels, MenuViews, UiKit
```

Everything world-related is a pure function of the seed — the save file
only stores the diff (player edits + looted containers).

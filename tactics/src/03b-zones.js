/* ZONES — the places the campaign moves through.

   An arena says what the ground is shaped like. A zone says where in the
   world that ground IS: what colour the light is, what the sky is doing, how
   far you can see, what is on the horizon, and which arena shapes belong
   there at all. It is the layer between "a board" and "a place".

   Zone one is the proving yard, and it is deliberately the dullest of the
   five: flat light, no weather, the most legible layout, the longest sight
   line. It is where a thing that has gone wrong is obvious, because nothing
   else in the frame is competing. The other four are drafts — complete
   enough to load and play, tuned only as far as looking at them has taken
   them, and each is one data object, so tuning one cannot break another.

   Everything here is data except two helpers. A zone owns no code path of
   its own: the renderer asks it for a sky, the grid asks it for a palette,
   the campaign asks it which layouts to roll. Add a sixth by adding an entry.
*/
(function (K) {
  'use strict';
  const U = K.util;
  const D = Math.PI / 180;

  /* ------------------------------------------------------------- the five */

  const LIST = [
    {
      id: 'proving',
      name: 'THE PROVING YARD',
      blurb: 'Flat light, a long sight line, and nothing on the field that is not there to be tested.',
      test: true,
      /* The reference zone. Overcast late afternoon: the light has no colour
         of its own, so anything that looks wrong here is wrong, not lit
         wrong. No weather, because weather hides things. */
      sky: {
        stops: ['#5a6678', '#7c8798', '#9aa3b0', '#b2b3b3'],
        below: '#2a2f39',
        haze: '#b7bcc4', hazeA: 0.55
      },
      sun: { az: 205 * D, alt: 34 * D, r: 0.030, col: '#fdfaf0', glow: '#e9ecef', glowR: 7.5, glowA: 0.30 },
      stars: 0,
      ridge: { col: '#3b4250', base: 1.6 * D, amp: 1.1 * D, freq: 5, seed: 11, teeth: 0.55 },
      motes: null,
      fog: [116, 124, 138], near: 24, far: 104,
      ground: { col: '#6d7482', mix: 0.10 },
      layouts: ['courtyard'],
      waves: [1, 2]
    },

    {
      id: 'ashfall',
      name: 'ASHFALL TERRACES',
      blurb: 'The mountain is still burning somewhere above you. Everything here is downhill from that.',
      sky: {
        stops: ['#1b0f12', '#3a1a18', '#77301f', '#c2582a'],
        below: '#160c0e',
        haze: '#e0783a', hazeA: 0.45
      },
      sun: { az: 20 * D, alt: 7 * D, r: 0.042, col: '#ffd08a', glow: '#ff8a3c', glowR: 11, glowA: 0.42 },
      stars: 0,
      ridge: { col: '#1a1013', base: 3.5 * D, amp: 9.5 * D, freq: 3, seed: 47, teeth: 0.85 },
      // embers, going up, because everything here came off a fire
      motes: { n: 70, col: '#ffb15e', rise: true, speed: 0.055, size: 1.9, a: 0.7 },
      fog: [92, 52, 44], near: 21, far: 78,
      ground: { col: '#6a4436', mix: 0.46 },
      layouts: ['spires', 'chasm'],
      waves: [3, 4]
    },

    {
      id: 'march',
      name: 'THE DROWNED MARCH',
      blurb: 'A causeway country. The parts that are not water are only briefly not water.',
      sky: {
        stops: ['#2d3a48', '#526879', '#8ba0a8', '#c3cbc4'],
        below: '#1d262e',
        haze: '#cdd6d0', hazeA: 0.72
      },
      sun: { az: 140 * D, alt: 4 * D, r: 0.034, col: '#ffeccc', glow: '#dfe4d8', glowR: 9, glowA: 0.34 },
      stars: 0,
      ridge: { col: '#2b3742', base: 0.7 * D, amp: 1.6 * D, freq: 9, seed: 88, teeth: 0.30 },
      // mist, drifting down and across: the reason you cannot see the far bank
      motes: { n: 46, col: '#cfdad6', rise: false, speed: 0.020, size: 5.5, a: 0.22 },
      fog: [138, 152, 150], near: 19, far: 66,
      ground: { col: '#41595a', mix: 0.44 },
      layouts: ['chasm', 'courtyard'],
      waves: [5, 6]
    },

    {
      id: 'glasswaste',
      name: 'THE GLASSWASTE',
      blurb: 'Salt, and the flat glare off it. There is nothing to hide behind for a day in any direction.',
      sky: {
        stops: ['#3f6ea8', '#79a5cd', '#b9d2e2', '#ecebdf'],
        below: '#8e8974',
        haze: '#f4f0dd', hazeA: 0.50
      },
      sun: { az: 300 * D, alt: 58 * D, r: 0.026, col: '#ffffff', glow: '#fff6d2', glowR: 9, glowA: 0.45 },
      stars: 0,
      // barely a horizon at all: that is the point of the place
      ridge: { col: '#9c9a86', base: 0.35 * D, amp: 0.5 * D, freq: 13, seed: 5, teeth: 0.15 },
      motes: null,
      fog: [206, 200, 176], near: 30, far: 120,
      ground: { col: '#b9b195', mix: 0.46 },
      layouts: ['courtyard', 'spires'],
      waves: [7, 7]
    },

    {
      id: 'ironcrown',
      name: 'THE IRON CROWN',
      blurb: 'The keep itself, at night, with everyone left inside it awake and expecting you.',
      sky: {
        stops: ['#05070f', '#0b1122', '#141d38', '#243050'],
        below: '#04060c',
        haze: '#3d4c74', hazeA: 0.40
      },
      sun: { az: 250 * D, alt: 41 * D, r: 0.036, col: '#ffe9b0', glow: '#d8bfa0', glowR: 8, glowA: 0.26 },
      stars: 150,
      ridge: { col: '#080b14', base: 4.0 * D, amp: 7.0 * D, freq: 2, seed: 3, teeth: 0.95 },
      motes: { n: 34, col: '#ffc978', rise: true, speed: 0.038, size: 1.6, a: 0.55 },
      fog: [34, 40, 62], near: 20, far: 72,
      ground: { col: '#2f3750', mix: 0.58 },
      layouts: ['citadel'],
      waves: [8, 8]
    }
  ];

  const byId = (id) => LIST.find(z => z.id === id) || LIST[0];

  /* Which zone a campaign wave happens in. The waves ranges are inclusive and
     cover 1..8; anything past the end stays in the last zone, so a longer run
     than the campaign currently has does not fall off the table. */
  function forWave(wave) {
    for (const z of LIST) if (wave >= z.waves[0] && wave <= z.waves[1]) return z;
    return LIST[LIST.length - 1];
  }

  /* The layout a zone wants for a given wave. Zones name the arena shapes
     that belong to them; the seed picks between them, so a zone is a place
     with several boards rather than one board seen repeatedly. */
  function layoutFor(zone, seed) {
    const l = zone.layouts;
    return l[Math.floor(U.rng(seed * 7919 + 13)() * l.length) % l.length];
  }

  K.zones = { LIST, byId, forWave, layoutFor };
})(window.K = window.K || {});

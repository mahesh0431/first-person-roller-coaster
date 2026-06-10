# First-Person Roller Coaster

A fun experiment: what happens when you ask GPT-5.5 in Codex to build a first-person roller coaster web experience, then push it toward the kind of cinematic, mythic, Fable/Mythos-style feeling people imagine when they say "make it feel real"?

It is not a physics-certified simulator and it is not AAA photorealism. It is a browser-native WebGL ride that tries to sell the sensation with camera motion, banking, speed changes, sound cues, and a full-screen POV.

## Live Demo

https://mahesh0431.github.io/first-person-roller-coaster/

## What It Does

- First-person coaster camera with banked turns and slope-based speed
- Dusk amusement-park world with track supports, tunnel, station, lights, trees, and terrain
- Ride HUD for speed, altitude, g-force, bank angle, FPS, and zone
- Pause, restart, mute, settings, and emergency stop controls
- Comfort mode with reduced motion and horizon lock options
- Browser-native generated audio cues for wind, rumble, lift, and brakes

## Run Locally

```bash
npm install
npm run dev
```

Then open the local URL Vite prints.

## Build

```bash
npm run build
```

## Notes

The strongest part is the ride feel: arc-length movement, camera banking, speed changes, and near-field track cues. The world art is intentionally lightweight procedural Three.js so it can run easily in a browser.

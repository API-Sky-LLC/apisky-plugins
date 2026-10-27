---
name: routing
description: Routing order and rules for power, differential pairs and long buses. Load when routing a board or fixing a failed DRC.
---

# Routing

Order matters more than tidiness: route what cannot be moved first.

1. **Placement**: connectors on the edges, power section away from analog, crystal next to
   the MCU pins, decoupling right at the power pin.
2. **Power**: track width from current (~1 A per 0.5 mm of 35 µm copper at an acceptable
   temperature rise), duplicate vias, ground pour on the first layer.
3. **Differential pairs**: equal length within the pair, equal gap over the whole run, as few
   vias as possible, never across a layer change without a return path.
4. **High-speed buses**: length within the group inside the datasheet tolerance, continuous
   ground reference under the track.
5. **The rest**: signal traces last, 45° corners, as few layers as possible.

Finish every layer with a ground pour. If a track cuts the pour in two, that is a routing bug,
not cosmetics: go back to placement.

LD53 - TBD
============================

Ludum Dare 53 Entry by Jimbly - "Deliver Shapes"

* Play here: [dashingstrike.com/LudumDare/LD53/](http://www.dashingstrike.com/LudumDare/LD53/)
* Using [Javascript libGlov/GLOV.js framework](https://github.com/Jimbly/glovjs)

Acknowledgements:
* [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) font

Start with: `npm start` (after running `npm i` once)

Plan: Mini-metro Factories  "Mini-Factory"?
* X factories: sources, converters, sinks
* X scrollable play area
* X currency/inventory display in upper right
* X click node, then another node to add a delivery route
* X click button on route to upgrade or downgrade/cancel
* X limit to number of routes
* NO buy things (just more routes and upgrades and victory) in panel on the right (no undo)
* X click unactivated factory to spend cost and activate it (no undo)
  * X this also adds additional routes and upgrades, I think
* NO * click button on factory to upgrade
* X change to circles
* X add shapes, arrows, link icon, tweak layout appropriately
* NO maybe: disable any node to turn it into storage/routing instead of a factory (flip card over visually?)
* X color nodes that do not have a valid source
* musical notes upon every shape consumption
  * different note per shape - 8 shapes
  * secondary low note for when a given shape happening too often (complete switch? once per second to high?)
    * also switch to 50% fewer high notes when links are all used up?
* sfx:
  * button rollover, click
  * node unlock (unlock sound, not music?)
  * error: not enough links
  * add/upgrade/remove link
  * victory jingle
* send out for playtest
* a couple more tiers, large play space?
* give "partial victory" if you get 1 victory token, but do not have a stable setup
  * full unfulfilled: nodes need to be colored if all sources have at least 1 green source themselves (or, rather, just paint out from sources)
  * Zach-like the high scores with victory (0/1/2) first and then min time, min used links, min total links (track this by how many were actually used ever!)
  * 2 levels - intro (simpler tree), random full level 1 with good seed, then infinite past that?

Polish
* X different color node background for locked ones (half way to BG?)
* X when a node is selected, clicking the same node should deselect it (except if num links = 0)
* X link count should be bottom center - floaters/status comes out of there too?
* links should turn red (after unlock) if they're not useful
* what would be needed for GAMESPEED_SCALE=20 or equivalent without losing the simplicity?
* flow should be just an emission time, not a max number on the pipe - evaluate this change after adding musical notes
* flow should count the ones in the immediately considered pipe to decide if we're going over max (and just cap it for multi-pipe situations)
* allow dragging from nodes to create paths
* keyboard/wasd scroll - or, just auto-center the focus'd node (smooth pan?), would even work for controller
  * would need spot for canceling lines, though, just simple one in the middle
* better way to add a bigger pipe (maybe button shows up on hover near 1/2 distance from each end or something)
* smooth zooming
* maybe pulse factories as they produce, color fades to less bright when they're idle
* pinch-zoom on mobile
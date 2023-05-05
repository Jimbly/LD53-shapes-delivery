LD53 - Delivery
============================

Ludum Dare 53 Entry by Jimbly - "▲●■♚ - Shapes Delivery"

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
* X musical notes upon every shape consumption
  * X different note per shape - 8 shapes
* X sfx:
  * button rollover, click
  * node unlock (unlock sound, not music?)
  * error: not enough links
  * add/upgrade/remove link
  * victory jingle
* X give "partial victory" if you get 1 victory token, but do not have a stable setup
  * X Zach-like the high scores with victory (0/1/2) first and then min time, min used links
  * X 2 levels - intro (simpler tree), random full level 1 with good seed, then infinite past that?
* menu button in lower left to go to high scores / mfx toggle
* X from high scores, lower left goes back to game, lower right has Restart level, upper has previous/next level buttons
* a couple more tiers, large play space?

Polish
* X different color node background for locked ones (half way to BG?)
* X when a node is selected, clicking the same node should deselect it (except if num links = 0)
* X link count should be bottom center - floaters/status comes out of there too?
* links should turn red (after unlock) if they're not useful
* what would be needed for GAMESPEED_SCALE=20 or equivalent without losing the simplicity?
* flow should be just an emission time, not a max number on the pipe - evaluate this change after adding musical notes
* flow should count the ones in the immediately considered pipe to decide if we're going over max (and just cap it for multi-pipe situations)
* alternate numbers that are just dots, show them under the inputs/outputs, get rid of inventory?
* (post-compo) allow dragging from nodes to create paths
* keyboard/wasd scroll - or, just auto-center the focus'd node (smooth pan?), would even work for controller
  * would need spot for canceling lines, though, just simple one in the middle
* better way to add a bigger pipe (maybe button shows up on hover near 1/2 distance from each end or something)
* smooth zooming
* maybe pulse factories as they produce, color fades to less bright when they're idle
* (post-compo) pinch-zoom on mobile

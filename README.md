LD53 - TBD
============================

Ludum Dare 53 Entry by Jimbly - "Unnamed"

* Play here: [dashingstrike.com/LudumDare/LD53/](http://www.dashingstrike.com/LudumDare/LD53/)
* Using [Javascript libGlov/GLOV.js framework](https://github.com/Jimbly/glovjs)

Start with: `npm start` (after running `npm i` once)

Plan: Mini-metro Factories  "Mini-Factory"?
X factories: sources, converters, sinks
X scrollable play area
X currency/inventory display in upper right
X click node, then another node to add a delivery route
X click button on route to upgrade or downgrade/cancel
X limit to number of routes
NO buy things (just more routes and upgrades and victory) in panel on the right (no undo)
X click unactivated factory to spend cost and activate it (no undo)
  X this also adds additional routes and upgrades, I think
NO * click button on factory to upgrade
* change to circles; add shapes;
* send out for playtest
* maybe: disable any node to turn it into storage/routing instead of a factory (flip card over visually?)

Polish
* link count should be bottom center - floaters/status comes out of there too?
* flow should be just an emission time, not a max number on the pipe - evaluate this change after adding musical notes
* flow should count the ones in the immediately considered pipe to decide if we're going over max (and just cap it for multi-pipe situations)
* allow dragging from nodes to create paths
* smooth zooming
* on AE->D, put D last
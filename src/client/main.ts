/*eslint global-require:off*/
// eslint-disable-next-line import/order
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('ld53'); // Before requiring anything else that might load from this

import assert from 'assert';
import * as camera2d from 'glov/client/camera2d';
import * as engine from 'glov/client/engine';
import { getFrameTimestamp } from 'glov/client/engine';
import { ALIGN, Font, fontStyle } from 'glov/client/font';
// import * as input from 'glov/client/input';
import {
  KEYS,
  click,
  drag,
  keyDown,
  mouseOver,
  mousePos,
  mouseWheel,
} from 'glov/client/input';
import * as net from 'glov/client/net';
import {
  SPOT_DEFAULT_BUTTON,
  spot,
} from 'glov/client/spot';
import { spriteSetGet } from 'glov/client/sprite_sets';
import { Sprite, spriteCreate } from 'glov/client/sprites';
// import * as ui from 'glov/client/ui';
import {
  LINE_ALIGN,
  drawBox,
  drawLine,
  modalDialog,
} from 'glov/client/ui';
import { randCreate } from 'glov/common/rand_alea';
import {
  lerp,
  ridx,
} from 'glov/common/util';
import {
  Vec2,
  v2addScale,
  v2copy,
  v2dist,
  v2iNormalize,
  v2lengthSq,
  v2linePointDist,
  v2scale,
  v2sub,
  vec2,
} from 'glov/common/vmath';
import * as islandjoy from './islandjoy';
import { poissonSample } from './poisson';
import { statusPush, statusTick } from './status';

const { min } = Math;

const COLOR_FACTORY_BG = islandjoy.colors[3];
const COLOR_FACTORY_BORDER_LOCKED = islandjoy.colors[3];
const COLOR_FACTORY_BORDER_ACTIVE = islandjoy.colors[7];
// const COLOR_FACTORY_BORDER_NOINPUT = islandjoy.colors[9];
// const COLOR_FACTORY_BORDER_FULL = islandjoy.colors[12];
const COLOR_FACTORY_BORDER_SELECTED = islandjoy.colors[1];
const COLOR_FACTORY_BORDER_ROLLOVER = islandjoy.colors[0];
const COLOR_FACTORY_BORDER_TARGETABLE = islandjoy.colors[8];

const link_hover_style = fontStyle(null, {
  outline_width: 4,
  outline_color: islandjoy.font_colors[3],
  color: islandjoy.font_colors[0],
});

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.SPRITES = 10;
Z.LINKS = 10;
Z.TRAFFIC = 20;
Z.NODES = 30;
Z.WALLET = 40;
Z.STATUS = 60;

// Virtual viewport for our game logic
const game_width = 1000;
const game_height = 1000;
let font: Font;

const SCALE = 100;

const TRAVEL_SPEED = 4/1000;

const SHAPE_COLORS: number[] = [
  2,
  7,
  9,
  12,
  8,
  13,
  14,
  5,
  10,
  6,
];
const SHAPE_LABELS = SHAPE_COLORS.map((a, indx) => String.fromCharCode('A'.charCodeAt(0) + indx));

let sprite_bubble: Sprite;
function init(): void {
  sprite_bubble = spriteCreate({
    name: 'bubble',
    layers: 2,
    ws: [96, 256-96-96, 96],
    hs: [96, 256-96-96, 96],
  });
}
type Shape = number;
type Node = {
  unlocked: boolean;
  index: number;
  cost: Shape;
  cost_paid: 0;
  pos: Vec2;
  screenpos: Vec2;
  ninput: Shape[];
  noutput: Shape[];
  nshapes: Record<Shape, number>;
  needs: Record<Shape, number>;
};
type LinkShape = {
  shape: Shape;
  start_t: number;
};
type LinkTraffic = {
  last_t: number;
  lshapes: LinkShape[];
};
type Link = {
  start: number;
  end: number;
  width: number;
  length: number;
  forward: LinkTraffic;
  reverse: LinkTraffic;
};

function isSource(n: Node): boolean {
  return n.ninput.length === 0 && n.noutput.length === 1 && n.unlocked;
}
function isSink(n: Node): boolean {
  return n.noutput.length === 0;
}
const MAX_NEED = 9;
function nodeNeeds(target: Node, shape: Shape, max_need: number): boolean {
  if (isSink(target)) {
    return true;
  }
  if (target.unlocked) {
    if (target.ninput.indexOf(shape) !== -1) {
      if ((target.nshapes[shape] || 0) < max_need) {
        return true;
      }
    }
  } else {
    if (target.cost === shape) {
      return true;
    }
  }
  return false;
}

function nodeNeeds2(target: Node, source: Node): number {
  assert(!isSource(target));
  if (source.nshapes) {
    for (let key in source.nshapes) {
      let shape = Number(key);
      let count = source.nshapes[key];
      if (nodeNeeds(source, shape, Infinity)) {
        // but, we want it
        continue;
      }
      if (count && nodeNeeds(target, shape, MAX_NEED)) {
        return shape;
      }
    }
  }
  return -1;
}

function nodePotentiallyNeeds(target: Node, source: Node): boolean {
  for (let ii = 0; ii < source.noutput.length; ++ii) {
    let output = source.noutput[ii];
    if (target.unlocked) {
      for (let jj = 0; jj < target.ninput.length; ++jj) {
        if (target.ninput[jj] === output) {
          return true;
        }
      }
    } else {
      if (target.cost === output) {
        return true;
      }
    }
  }
  return false;
}

function removeShape(node: Node, shape: Shape): void {
  assert(node.nshapes);
  for (let key in node.nshapes) {
    let target_shape = Number(key);
    if (target_shape === shape) {
      node.nshapes[key]--;
      // if (!node.nshapes[key]) {
      //   delete node.nshapes[key];
      // }
      return;
    }
  }
  assert(false);
}

type NodeType = ([Shape, Shape, Shape, Shape] | [Shape, Shape] | [Shape]);
const NODE_TYPES: NodeType[] = [
  // cost, output, input1, input2
  // [-1], // free sink
  [2, 0], // fist 0-generator free, later costs 2
  [0, 1, 0, 0], // 0+0=1
  [1, 2, 0, 1], // 0+1=2
  [2, 3, 0, 2], // 0+2=3
  [3, 4, 1, 2], // 1+2=4
  [4, 5, 3, 4], // 3+4=5
  // [5, 4, 1, 3], // alt: 1+3=4
  [5, 6, 5, 2], // 2+5=6
  [6, 3, 0, 4], // alt: 0+4=3
  [6, 7, 6, 3], // 3+6=7
  // TODO: more A+A = B kind of conversions?  analyze total cost in As of each of these steps
];

const UNLOCK_COST = [
  3, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90
];
const UNLOCK_COST_DEFAULT = 100;


class GameState {
  nodes: Node[] = [];
  links: Link[] = [];
  max_links = 1;
  did_victory = false;
  wallet: Partial<Record<Shape, number>>;
  t: number = 0;
  dt: number = 0;
  viewport = {
    x: 0, y: 0, scale: 1,
  };
  rand = randCreate(1);
  unlocks_by_cost: Partial<Record<Shape, number>> = {};
  unlocks_total = 0;
  constructor() {
    this.wallet = {};
    // this.addNode(vec2(-3, 0), NODE_TYPES[1]);
    // this.addNode(vec2(-1, -3), NODE_TYPES[2]);
    // this.addNode(vec2(3, -1), NODE_TYPES[0]);
    // this.addLink(0, 1);
    // this.addLink(0, 2);
    // this.addLink(0, 2);
    // this.addLink(2, 1);

    const W = 30;
    const H = 30;
    let points = poissonSample(this.rand, 3, 40, W, H);
    let v2points = points.map((idx) => {
      let x = idx % W;
      let y = (idx - x) / W;
      return vec2(x - W/2, y - H/2);
    });
    v2points.sort((a: Vec2, b: Vec2) => {
      let da = v2lengthSq(a);
      let db = v2lengthSq(b);
      return da - db;
    });
    for (let ii = 0; ii < v2points.length; ++ii) {
      let type = ii % NODE_TYPES.length;
      this.addNode(v2points[ii], NODE_TYPES[type]);
    }
    this.nodes[0].unlocked = true;
    // this.nodes[1].unlocked = true;
  }
  addNode(pos: Vec2, type: NodeType): void {
    let ninput: Shape[] = [];
    let noutput: Shape[] = [];
    let cost = type[0];
    for (let ii = 1; ii < min(type.length, 2); ++ii) {
      noutput.push(type[ii]);
    }
    for (let ii = 2; ii < type.length; ++ii) {
      ninput.push(type[ii]);
    }
    let needs: Record<Shape, number> = {};
    for (let ii = 0; ii < ninput.length; ++ii) {
      needs[ninput[ii]] = (needs[ninput[ii]] || 0) + 1;
    }

    this.nodes.push({
      unlocked: false,
      index: this.nodes.length,
      cost,
      cost_paid: 0,
      pos,
      screenpos: v2scale(vec2(), pos, SCALE),
      ninput,
      noutput,
      needs,
      nshapes: {},
    });
  }
  findLink(start: number, end: number): Link | null {
    if (start > end) {
      let t = end;
      end = start;
      start = t;
    }
    let { links } = this;
    for (let ii = 0; ii < links.length; ++ii) {
      let link = links[ii];
      if (link.start === start && link.end === end) {
        return link;
      }
    }
    return null;
  }
  addLink(start: number, end: number): void {
    let link = this.findLink(start, end);
    if (link) {
      link.width++;
      return;
    }
    if (start > end) {
      let t = end;
      end = start;
      start = t;
    }
    let { links } = this;
    links.push({
      start, end,
      width: 1,
      length: v2dist(this.nodes[start].pos, this.nodes[end].pos),
      forward: {
        last_t: 0,
        lshapes: []
      },
      reverse: {
        last_t: 0,
        lshapes: [],
      },
    });
  }
  removeLink(link: Link): void {
    if (link.width > 1) {
      link.width--;
      return;
    }
    let { links } = this;
    let idx = links.indexOf(link);
    assert(idx !== -1);
    ridx(links, idx);
  }

  addShape(node: Node, shape: Shape): void {
    if (isSink(node)) {
      this.wallet[shape] = (this.wallet[shape] || 0) + 1;
      return;
    }
    if (node.unlocked) {
      if (nodeNeeds(node, shape, Infinity)) {
        node.nshapes[shape] = (node.nshapes[shape] || 0) + 1;
      } // else, was probably on the way to unlock a locked node
    } else {
      assert(node.cost === shape);
      node.cost_paid++;
      if (node.cost_paid >= this.unlockCost(node)) {
        node.unlocked = true;
        this.unlocks_total++;
        this.unlocks_by_cost[node.cost] = (this.unlocks_by_cost[node.cost] || 0) + 1;
        // TODO: floater?
        this.max_links++;
      }
    }
  }

  tickLinkTraffic(link: Link, nodea: Node, nodeb: Node, traffic: LinkTraffic): void {
    let { t } = this;
    let { lshapes } = traffic;
    let { length } = link;
    let traveltime = length / TRAVEL_SPEED;

    for (let ii = lshapes.length - 1; ii >= 0; --ii) {
      let shape = lshapes[ii];
      if (t - shape.start_t > traveltime) {
        // deliver shape
        this.addShape(nodeb, shape.shape);
        ridx(lshapes, ii);
      }
    }
  }

  tickLinkEmit(link: Link, nodea: Node, nodeb: Node, traffic: LinkTraffic): boolean {
    let { t } = this;
    let { lshapes } = traffic;
    let { length } = link;
    let traveltime = length / TRAVEL_SPEED;
    let ret = false;

    if (!nodea.unlocked) {
      return ret;
    }

    let time_since_emit_allowed = (t - traffic.last_t) - traveltime/link.width;
    if (time_since_emit_allowed >= 0 && lshapes.length < (link.width * 2 - 1) && !isSource(nodeb)) {
      // potentially emit
      let emit = -1;
      if (isSource(nodea)) {
        assert.equal(nodea.noutput.length, 1);
        if (nodeNeeds(nodeb, nodea.noutput[0], MAX_NEED)) {
          emit = nodea.noutput[0];
        }
      } else {
        emit = nodeNeeds2(nodeb, nodea);
        if (emit !== -1) {
          removeShape(nodea, emit);
          ret = true;
        }
      }
      if (emit !== -1) {
        if (time_since_emit_allowed < this.dt) {
          t -= time_since_emit_allowed;
        }
        lshapes.push({
          start_t: t,
          shape: emit,
        });
        traffic.last_t = t;
      }
    }
    return ret;
  }

  linkCount(): number {
    let count = 0;
    for (let ii = 0; ii < this.links.length; ++ii) {
      let { width } = this.links[ii];
      count += width;
    }
    return count;
  }

  hasFreeLinks(): boolean {
    return this.linkCount() < this.max_links;
  }

  unlockCost(node: Node): number {
    assert(!node.unlocked);
    let count = this.unlocks_by_cost[node.cost] || 0;
    return (UNLOCK_COST[count] || UNLOCK_COST_DEFAULT) + this.unlocks_total;
  }

  tickNode(node: Node): void {
    let { ninput, noutput, needs, nshapes, unlocked } = node;
    if (ninput.length && noutput.length && unlocked) {
      // factory
      let satisfied = true;
      for (let shape in needs) {
        if (needs[shape] > (nshapes[shape] || 0)) {
          satisfied = false;
        }
      }
      if (satisfied) {
        satisfied = false;
        // only output if some output is needed
        for (let ii = 0; ii < noutput.length; ++ii) {
          if ((nshapes[noutput[ii]] || 0) < MAX_NEED) {
            satisfied = true;
          }
        }
      }
      if (satisfied) {
        for (let shape in needs) {
          nshapes[shape] -= needs[shape];
          // if (!nshapes[shape]) {
          //   delete nshapes[shape];
          // }
        }
        for (let ii = 0; ii < noutput.length; ++ii) {
          let shape = noutput[ii];
          nshapes[shape] = (nshapes[shape] || 0) + 1;
          if (shape === 7 && !this.did_victory) {
            this.did_victory = true;
            modalDialog({
              title: 'Victory!',
              text: 'You win!',
              buttons: { ok: null },
            });
          }
        }
      }
    }
  }

  tick(dt: number): void {
    if (keyDown(KEYS.SHIFT)) {
      dt *= 10;
    }
    this.dt = dt;
    this.t += dt;
    let { links, nodes } = this;
    for (let ii = 0; ii < links.length; ++ii) {
      let link = links[ii];
      let nodea = nodes[link.start];
      let nodeb = nodes[link.end];
      this.tickLinkTraffic(link, nodea, nodeb, link.forward);
      this.tickLinkTraffic(link, nodeb, nodea, link.reverse);
    }

    for (let ii = 0; ii < nodes.length; ++ii) {
      this.tickNode(nodes[ii]);
    }


    let any_need_swap = false;
    let do_swap: Record<number, boolean> = {};
    for (let ii = 0; ii < links.length; ++ii) {
      let link = links[ii];
      let nodea = nodes[link.start];
      let nodeb = nodes[link.end];
      let swap = this.tickLinkEmit(link, nodea, nodeb, link.forward);
      swap = this.tickLinkEmit(link, nodeb, nodea, link.reverse) || swap;
      if (swap) {
        do_swap[ii] = true;
        any_need_swap = true;
      }
    }
    if (any_need_swap) {
      let new_links_first: Link[] = [];
      let new_links_last: Link[] = [];
      for (let ii = 0; ii < links.length; ++ii) {
        if (do_swap[ii]) {
          new_links_last.push(links[ii]);
        } else {
          new_links_first.push(links[ii]);
        }
      }
      this.links = new_links_first.concat(new_links_last);
    }
  }


  selected = -1;
}
let game_state: GameState;

const NODE_W = 250;
const NODE_H = 150;
const NW2 = NODE_W / 2;
const NH2 = NODE_H / 2;
const ICON_W = 32;
const ARROW_W = 48;
const ICON_PAD = 2;
const NODE_PAD = 9;
const LINE_W = 8;
const LINE_SHIFT = NODE_H / 2 - ICON_W;

function drawShapeCount(x: number, y: number, z: number, shape: Shape, count?: number, scale?: number): void {
  scale = scale || 1;
  font.draw({
    x, y, z,
    size: ICON_W * scale,
    align: ALIGN.HVCENTER,
    text: SHAPE_LABELS[shape],
    color: islandjoy.font_colors[SHAPE_COLORS[shape]],
  });
  if (count !== undefined) {
    font.draw({
      x: x - ICON_W/2*scale, y, z: z + 1, w: ICON_W*scale,
      size: ICON_W*scale,
      align: ALIGN.HVCENTERFIT,
      text: String(count),
    });
  }
}

function drawLinkTraffic(link: Link, x0: number, y0: number, x1: number, y1: number, traffic: LinkTraffic): void {
  let traveltime = link.length / TRAVEL_SPEED;
  for (let ii = 0; ii < traffic.lshapes.length; ++ii) {
    let shape = traffic.lshapes[ii];
    let tt = (game_state.t - shape.start_t) / traveltime;
    drawShapeCount(lerp(tt, x0, x1), lerp(tt, y0, y1), Z.TRAFFIC, shape.shape, undefined);
  }
}

let delta = vec2();
let posa = vec2();
let posb = vec2();
function drawLinkPos(
  width: number, posa_in: Vec2, posb_in: Vec2, bdelta: boolean, for_delete: boolean, is_invalid: boolean
): void {
  v2copy(posa, posa_in);
  v2copy(posb, posb_in);
  v2sub(delta, posa, posb);
  v2iNormalize(delta);
  v2addScale(posa, posa, delta, -LINE_SHIFT);
  if (bdelta) {
    v2addScale(posb, posb, delta, LINE_SHIFT);
  }
  let color = islandjoy.colors[for_delete ? 12 : 1];
  if (is_invalid) {
    color = islandjoy.colors[(getFrameTimestamp() % 200 > 100) ? 12 : 8];
  }
  drawLine(posa[0], posa[1], posb[0], posb[1], Z.LINKS, LINE_W, 1, color);
  if (width > 1) {
    let linew = LINE_W;
    let z = Z.LINKS;
    let bit = 0;
    while (width) {
      linew += LINE_W * 0.5;
      z -= 0.01;
      bit = 1 - bit;
      width--;
      drawLine(posa[0], posa[1], posb[0], posb[1], z, linew, 1, islandjoy.colors[for_delete ? 13 : bit ? 12 : 10]);
    }
  }
}
function drawLink(link: Link): void {
  let nodea = game_state.nodes[link.start];
  let pa = nodea.screenpos;
  let nodeb = game_state.nodes[link.end];
  let pb = nodeb.screenpos;
  drawLinkPos(link.width, pa, pb, true, false, false);
  drawLinkTraffic(link, pa[0], pa[1], pb[0], pb[1], link.forward);
  drawLinkTraffic(link, pb[0], pb[1], pa[0], pa[1], link.reverse);
}

// line segment intercept math by Paul Bourke http://paulbourke.net/geometry/pointlineplane/
const EPSILON = 0.01;
function lineLineIntersectIgnoreEnds(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  let denominator = ((p4[1] - p3[1]) * (p2[0] - p1[0]) - (p4[0] - p3[0]) * (p2[1] - p1[1]));
  let numa = ((p4[0] - p3[0]) * (p1[1] - p3[1]) - (p4[1] - p3[1]) * (p1[0] - p3[0]));
  let numb = ((p2[0] - p1[0]) * (p1[1] - p3[1]) - (p2[1] - p1[1]) * (p1[0] - p3[0]));

  if (denominator === 0) {
    // lines are parallel, or 0-length line
    if (!numa && !numb) {
      // lines are coincident
      return true;
    }
    return false;
  }

  let ua = numa / denominator;
  let ub = numb / denominator;

  // is the intersection along the segments
  if (ua < EPSILON || ua > 1-EPSILON || ub < EPSILON || ub > 1-EPSILON) {
    return false;
  }

  return true;
  // let x = p1[0] + ua * (p2[0] - p1[0]);
  // let y = p1[1] + ua * (p2[1] - p1[1]);
  // return [x, y];
}


function isLinkValid(p1: Vec2, p2: Vec2): boolean {
  let { links, nodes } = game_state;
  for (let ii = 0; ii < links.length; ++ii) {
    let link = links[ii];
    let na = nodes[link.start];
    let nb = nodes[link.end];
    if (lineLineIntersectIgnoreEnds(p1, p2, na.screenpos, nb.screenpos)) {
      return false;
    }
  }
  return true;
}

let mouse_pos = vec2();
let link_target: number;
let link_clicked: boolean;
let last_link: string | null = null;
function doLinking(): void {
  let { nodes, links } = game_state;
  let link_valid = false;
  if (game_state.selected !== -1) {
    let selnode = nodes[game_state.selected];

    if (link_target !== -1 && link_target !== game_state.selected) {
      let tnode = nodes[link_target];
      v2copy(mouse_pos, tnode.screenpos);

      let existing_link = game_state.findLink(selnode.index, link_target);
      if (existing_link) {
        link_valid = true;
      }
      font.draw({
        style: link_hover_style,
        x: (tnode.screenpos[0] + selnode.screenpos[0]) / 2,
        y: (tnode.screenpos[1] + selnode.screenpos[1]) / 2,
        z: Z.UI + 10,
        align: ALIGN.HVCENTER,
        text: existing_link ? `${existing_link.width} → ${existing_link.width + 1}` : '+',
      });
    } else {
      mousePos(mouse_pos);
    }

    if (!link_valid && isLinkValid(selnode.screenpos, mouse_pos)) {
      link_valid = true;
    }

    drawLinkPos(1, selnode.screenpos, mouse_pos, false, false, !link_valid);
  }

  if (link_clicked) {
    if (game_state.selected === -1) {
      game_state.selected = link_target;
    } else if (!link_valid) {
      game_state.selected = -1;
    } else if (game_state.selected === link_target) {
      game_state.selected = -1;
    } else if (!game_state.hasFreeLinks()) {
      statusPush('Need more <-> !');
    } else {
      assert(link_target !== -1);
      // try to make link
      game_state.addLink(game_state.selected, link_target);
      game_state.selected = -1;
    }
  } else if (game_state.selected !== -1 && click()) {
    game_state.selected = -1;
  }

  let did_link = false;
  if (game_state.selected === -1) {
    mousePos(mouse_pos);
    for (let ii = links.length - 1; ii >= 0; --ii) {
      let link = links[ii];
      let nodea = nodes[link.start];
      let nodeb = nodes[link.end];
      let d = v2linePointDist(nodea.screenpos, nodeb.screenpos, mouse_pos);
      if (d < LINE_W * 2) {
        did_link = true;
        let link_key = `link${ii}`;
        let spot_ret = spot({
          key: link_key,
          x: mouse_pos[0] - 1,
          y: mouse_pos[1] - 1,
          w: 2,
          h: 2,
          def: SPOT_DEFAULT_BUTTON,
        });
        let { focused, ret } = spot_ret;
        if (focused) {
          last_link = link_key;
          drawLinkPos(2, nodea.screenpos, nodeb.screenpos, true, true, false);
          font.draw({
            style: link_hover_style,
            x: (nodea.screenpos[0] + nodeb.screenpos[0]) / 2,
            y: (nodea.screenpos[1] + nodeb.screenpos[1]) / 2,
            z: Z.UI + 10,
            align: ALIGN.HVCENTER,
            text: link.width === 1 ? 'X' : `${link.width} → ${link.width - 1}`,
          });
        }
        if (ret) {
          game_state.removeLink(link);
        }
        break;
      }
    }
  }
  if (!did_link && last_link) {
    spot({
      key: last_link,
      x: -9e9,
      y: -9e9,
      w: 1,
      h: 1,
      def: SPOT_DEFAULT_BUTTON,
    });
    last_link = null;
  }
}

function selectedNodeWants(node: Node): boolean {
  if (game_state.selected === -1) {
    return false;
  }
  let selnode = game_state.nodes[game_state.selected];
  assert(selnode !== node);
  if (nodePotentiallyNeeds(node, selnode)) {
    return true;
  }
  return false;
}

function nodeSelectable(node: Node): boolean {
  if (node.unlocked) {
    return true;
  }
  return selectedNodeWants(node);
}

function drawNode(node: Node): void {
  let x = node.screenpos[0] - NW2;
  let y = node.screenpos[1] - NH2;
  let z = Z.NODES;
  let w = NODE_W;
  let h = NODE_H;
  let box = {
    x, y, z, w, h,
  };

  let border_color = COLOR_FACTORY_BORDER_ACTIVE;
  if (!nodeSelectable(node)) {
    border_color = COLOR_FACTORY_BORDER_LOCKED;
  } else {

    if (game_state.selected === node.index) {
      border_color = COLOR_FACTORY_BORDER_SELECTED;
    } else {
      let spot_ret = spot({
        ...box,
        key: `node${node.index}${node.unlocked}`,
        def: SPOT_DEFAULT_BUTTON,
      });
      let { focused, ret } = spot_ret;
      if (focused || ret) {
        border_color = COLOR_FACTORY_BORDER_ROLLOVER;
        link_target = node.index;
        if (ret) {
          link_clicked = true;
        }
      }
    }
    if (game_state.selected === node.index) {
      border_color = COLOR_FACTORY_BORDER_SELECTED;
    } else if (selectedNodeWants(node)) {
      border_color = COLOR_FACTORY_BORDER_TARGETABLE;
    }
  }
  // always eat clicks and mouseover, even if not interactable, do not allow clicking links behind
  mouseOver(box);

  drawBox(box, sprite_bubble, 0.5, COLOR_FACTORY_BG, border_color);
  z++;

  let { ninput, noutput, nshapes } = node;

  let things = ninput.length + noutput.length;
  let arrow = true;
  if (isSink(node)) {
    arrow = false;
    things++;
  }
  if (isSource(node)) {
    arrow = false;
  }
  let scale = 1;
  if (!node.unlocked) {
    scale = 0.5;
  }
  let xx = x + (w - scale * (things * (ICON_W + ICON_PAD) + (arrow ? ARROW_W : -ICON_PAD))) / 2;
  let is_converter = ninput.length && noutput.length;
  if (!node.unlocked) {
    y += NODE_PAD;
    h -= NODE_PAD * 2;
    h /= 2;
    // Draw cost
    let total = game_state.unlockCost(node);

    let ss = 2;
    font.draw({
      x: xx - (ICON_W + ICON_PAD)/2 * ss - ICON_W/2*ss, y, z, w: ICON_W * ss, h,
      size: ICON_W * ss,
      align: ALIGN.HVCENTER,
      text: 'X', // Lock icon
      color: islandjoy.font_colors[12],
    });
    drawShapeCount(x + w/2, y + h/2, z, node.cost, total - node.cost_paid, ss);

    // draw reward
    y += h * 1.4;
    font.draw({
      x: x + w/2, y: y + 8, z,
      size: ICON_W * scale,
      align: ALIGN.HCENTER,
      text: '+1 <->',
      color: islandjoy.font_colors[1],
    });
  } else if (is_converter) {
    y += NODE_PAD;
    h -= NODE_PAD * 2;
    h /= 2;
  }

  for (let ii = 0; ii < ninput.length; ++ii) {
    let shape = ninput[ii];
    font.draw({
      x: xx, y, z, w: ICON_W * scale, h,
      size: ICON_W * scale,
      align: ALIGN.HVCENTER,
      text: SHAPE_LABELS[shape],
      color: islandjoy.font_colors[SHAPE_COLORS[shape]],
    });
    xx += (ICON_W + ICON_PAD) * scale;
  }
  if (arrow) {
    font.draw({
      x: xx, y, z, w: ARROW_W * scale, h,
      size: ICON_W * scale,
      align: ALIGN.HVCENTER,
      text: '→',
    });
    xx += (ARROW_W + ICON_PAD) * scale;
  }
  for (let ii = 0; ii < noutput.length; ++ii) {
    let shape = noutput[ii];
    font.draw({
      x: xx, y, z, w: ICON_W * scale, h,
      size: ICON_W * scale,
      align: ALIGN.HVCENTER,
      text: SHAPE_LABELS[shape],
      color: islandjoy.font_colors[SHAPE_COLORS[shape]],
    });
    xx += (ICON_W + ICON_PAD) * scale;
  }
  if (isSink(node)) {
    font.draw({
      x: xx, y, z, w: ICON_W * scale, h,
      size: ICON_W * scale,
      align: ALIGN.HVCENTER,
      text: '$',
      color: islandjoy.font_colors[8],
    });
    xx += (ICON_W + ICON_PAD) * scale;
  }
  if (is_converter && node.unlocked) {
    y += h;
    drawLine(x + NODE_PAD, y, x + w - NODE_PAD, y, z, 1, 1, islandjoy.colors[15]);

    things = Object.keys(nshapes).length;
    xx = x + (w - (things * (ICON_W + ICON_PAD) - ICON_PAD)) / 2;
    for (let key in nshapes) {
      let shape = Number(key);
      let count = nshapes[key];
      drawShapeCount(xx + ICON_W/2, y + h/2, z, shape, count);
      xx += ICON_W + ICON_PAD;
    }
  }
}

const WALLET_W = 200;
const WALLET_BORDER = 32;
const WALLET_PAD = 16;
function drawWallet(): void {
  let { wallet, max_links } = game_state;
  const x0 = camera2d.x1() - WALLET_W;
  const y0 = camera2d.y0();
  let z = Z.WALLET;
  let y = y0 + WALLET_PAD;
  let any = false;

  // TODO: links
  let link_count = game_state.linkCount();
  if (link_count) {
    font.draw({
      x: x0,
      y, z,
      w: WALLET_W/2 - WALLET_PAD/2,
      h: ICON_W,
      size: ICON_W,
      align: ALIGN.HRIGHT | ALIGN.VCENTER,
      text: `${link_count} / ${max_links}`,
      color: islandjoy.font_colors[link_count === max_links ? 12 : 0],
    });
    font.draw({
      x: x0 + WALLET_W/2 + WALLET_PAD/2,
      y, z,
      h: ICON_W,
      size: ICON_W,
      align: ALIGN.VCENTER,
      text: '<->',
      color: islandjoy.font_colors[1],
    });
    any = true;
  }

  let x = x0;
  let row = 0;
  for (let key in wallet) {
    let shape = Number(key);
    let count = wallet[key];
    if (row === 4) {
      x = x0;
      y += ICON_W + WALLET_PAD;
      row = 0;
    }
    drawShapeCount(x + ICON_W/2, y + ICON_W/2, z+1, shape, count);
    any = true;
    x += ICON_W + WALLET_PAD;
    row++;
  }
  y += ICON_W + WALLET_PAD/2;

  if (any) {
    drawBox({
      x: x0 - WALLET_BORDER, y: y0 - 500, z,
      w: WALLET_W + WALLET_BORDER + 500, h: y - y0 + WALLET_BORDER + 500,
    }, sprite_bubble, 0.5, islandjoy.colors[11], islandjoy.colors[0]);
  }
}

function statePlay(dt: number): void {
  camera2d.setAspectFixed2(game_width, game_height);
  gl.clearColor(islandjoy.colors[4][0], islandjoy.colors[4][1], islandjoy.colors[4][2], 1);

  game_state.tick(dt);

  let { nodes, links, viewport } = game_state;

  drawWallet();

  statusTick({
    x: camera2d.x0(), y: 0, w: camera2d.w(), h: camera2d.y1(),
    z: Z.STATUS,
    pad_bottom: 10,
    pad_top: 10,
  });

  // Draw nodes
  link_clicked = false;
  link_target = -1;
  camera2d.setAspectFixed(game_width * viewport.scale, game_height * viewport.scale);
  camera2d.shift((viewport.x * SCALE - game_width/2)*viewport.scale,
    (viewport.y * SCALE - game_height/2)*viewport.scale);
  for (let ii = 0; ii < links.length; ++ii) {
    let link = links[ii];
    drawLink(link);
  }
  for (let ii = 0; ii < nodes.length; ++ii) {
    let node = nodes[ii];
    drawNode(node);
  }

  doLinking();

  let drag_ret = drag({
    min_dist: 10,
  });
  if (drag_ret) {
    viewport.x -= drag_ret.delta[0] / SCALE / viewport.scale;
    viewport.y -= drag_ret.delta[1] / SCALE / viewport.scale;
  }
  let zoom = mouseWheel();
  if (zoom) {
    if (zoom < 0) {
      viewport.scale *= 1.25;
    } else {
      viewport.scale /= 1.25;
    }
    if (viewport.scale < 1) {
      viewport.scale = 1;
    }
  }
}

function playInit(): void {
  game_state = new GameState();
  engine.setState(statePlay);
}

export function main(): void {
  if (engine.DEBUG) {
    // Enable auto-reload, etc
    net.init({ engine });
  }

  const font_info_04b03x2 = require('./img/font/04b03_8x2.json');
  const font_info_04b03x1 = require('./img/font/04b03_8x1.json');
  const font_info_palanquin32 = require('./img/font/palanquin32.json');
  let pixely = 'off';
  let font_data;
  let ui_sprites;
  if (pixely === 'strict') {
    font_data = { info: font_info_04b03x1, texture: 'font/04b03_8x1' };
    ui_sprites = spriteSetGet('pixely');
  } else if (pixely && pixely !== 'off') {
    font_data = { info: font_info_04b03x2, texture: 'font/04b03_8x2' };
    ui_sprites = spriteSetGet('pixely');
  } else {
    font_data = { info: font_info_palanquin32, texture: 'font/palanquin32' };
  }

  if (!engine.startup({
    game_width,
    game_height,
    pixely,
    font: font_data,
    viewport_postprocess: false,
    antialias: false,
    ui_sprites,
    do_borders: false,
    line_mode: LINE_ALIGN,
    show_fps: false,
  })) {
    return;
  }

  font = engine.font;

  // ui.scaleSizes(13 / 32);
  // ui.setFontHeight(8);

  init();

  playInit();
}

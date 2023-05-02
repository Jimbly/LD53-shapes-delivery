/*eslint global-require:off*/
// eslint-disable-next-line import/order
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('ld53'); // Before requiring anything else that might load from this

import assert from 'assert';
import * as camera2d from 'glov/client/camera2d';
import * as engine from 'glov/client/engine';
import { getFrameTimestamp } from 'glov/client/engine';
import {
  ALIGN,
  Font,
  FontStyle,
  fontCreate,
  fontStyle,
  fontStyleColored,
} from 'glov/client/font';
// import * as input from 'glov/client/input';
import {
  KEYS,
  click,
  drag,
  keyDown,
  keyDownEdge,
  mouseOver,
  mousePos,
  mouseWheel,
} from 'glov/client/input';
import * as net from 'glov/client/net';
import {
  ScoreSystem,
  scoreAlloc,
} from 'glov/client/score.js';
import { scoresDraw } from 'glov/client/score_ui.js';
import * as settings from 'glov/client/settings';
import { soundLoad, soundPlay } from 'glov/client/sound';
import {
  SPOT_DEFAULT_BUTTON,
  spot,
} from 'glov/client/spot';
import { spriteSetGet } from 'glov/client/sprite_sets';
import { Sprite, spriteCreate } from 'glov/client/sprites';
// import * as ui from 'glov/client/ui';
import {
  LINE_ALIGN,
  buttonText,
  buttonWasFocused,
  drawBox,
  drawLine,
  playUISound,
} from 'glov/client/ui';
import { randCreate } from 'glov/common/rand_alea';
import {
  clone,
  lerp,
  ridx,
  sign,
} from 'glov/common/util';
import {
  Vec2,
  v2addScale,
  v2copy,
  v2dist,
  v2distSq,
  v2iNormalize,
  v2lengthSq,
  v2linePointDist,
  v2same,
  v2scale,
  v2sub,
  v4lerp,
  vec2,
  vec4,
} from 'glov/common/vmath';
import * as islandjoy from './islandjoy';
import { poissonSample } from './poisson';
import { statusSetFont, statusTick } from './status';

const { PI, abs, floor, max, min, sin } = Math;

const COLOR_FACTORY_BG = islandjoy.colors[3];
const COLOR_FACTORY_BG_LOCKED = v4lerp(vec4(), 0.5, islandjoy.colors[3], islandjoy.colors[4]);
// const COLOR_FACTORY_BG_VICTORY = v4lerp(vec4(), 0.5, COLOR_FACTORY_BG_LOCKED, islandjoy.colors[15]);
const COLOR_FACTORY_BORDER_LOCKED = COLOR_FACTORY_BG_LOCKED;
const COLOR_FACTORY_BORDER_ACTIVE = islandjoy.colors[7];
// const COLOR_FACTORY_BORDER_STARVED = islandjoy.colors[12];
const COLOR_FACTORY_BORDER_NOINPUT = islandjoy.colors[9];
const COLOR_FACTORY_BORDER_SELECTED = islandjoy.colors[1];
const COLOR_FACTORY_BORDER_ROLLOVER = islandjoy.colors[0];
const COLOR_FACTORY_BORDER_TARGETABLE = islandjoy.colors[8];

const link_hover_style = fontStyle(null, {
  outline_width: 4,
  outline_color: islandjoy.font_colors[3],
  color: islandjoy.font_colors[0],
});

const VICTORY_SHAPE = 8;

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
let symbolfont: Font;
let score_systema: ScoreSystem<ScoreData>;
let score_systemb: ScoreSystem<ScoreData>;

const SCALE = 100;

const GAMESPEED_SCALE = 1;

const TRAVEL_SPEED = 4/1000 * GAMESPEED_SCALE;

const SHAPE_COLORS: number[] = [
  2,
  7,
  9,
  12,
  13,
  14,
  5,
  10,
  8,
  6,
];
const SHAPE_LABELS = SHAPE_COLORS.map((a, indx) => String.fromCharCode('A'.charCodeAt(0) + indx));
const arrow_style = fontStyle(null, {
  glow_inner: -2.5,
  glow_outer: 5,
  glow_color: 0x00000040,
  color: islandjoy.font_colors[0],
});
const SHAPE_STYLE = SHAPE_COLORS.map((a) => fontStyle(arrow_style, {
  color: islandjoy.font_colors[a],
}));
const style_silver = fontStyle(arrow_style, {
  color: islandjoy.font_colors[8],
});
const number_style = fontStyle(null, {
  glow_inner: 0,
  glow_outer: 2,
  glow_color: 0x00000040,
  glow_xoffs: 1.5,
  glow_yoffs: 1,
  color: islandjoy.font_colors[0],
});

let sprite_bubble: Sprite;
let sprite_circle: Sprite;
let sprite_circle2: Sprite;
function init(): void {
  sprite_bubble = spriteCreate({
    name: 'bubble',
    layers: 2,
    ws: [96, 256-96-96, 96],
    hs: [96, 256-96-96, 96],
  });
  sprite_circle = spriteCreate({
    name: 'circle',
    layers: 2,
  });
  sprite_circle2 = spriteCreate({
    name: 'circle2',
    layers: 2,
  });
}
type Shape = number;
type Node = {
  unlocked: boolean;
  index: number;
  cost: Shape;
  cost_paid: number;
  extra_links: number;
  pos: Vec2;
  screenpos: Vec2;
  ninput: Shape[];
  noutput: Shape[];
  nshapes: Record<Shape, number>;
  needs: Record<Shape, number>;
  unfulfilled_raw: boolean;
  fulfilled_complete: boolean;
  satisfied_set: boolean[];
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
  uid: number;
  start: number;
  end: number;
  width: number;
  length: number;
  forward: LinkTraffic;
  reverse: LinkTraffic;
  fullfilled: boolean;
};

const sounds = [[
  'bass2-1',
  'harp2-1',
  'bass2-2',
  'harp2-2',
  'bass2-3',
  'harp2-3',
  'bass2-4',
  // 'bass2-5',
  // 'bass2-6',
  'harp2-4',
  'harp2-5',
  'harp2-6',
  'bass2-7',
], [
]];

function playShapeSound(shape: Shape): void {
  let list = sounds[0];
  soundPlay(list[shape % list.length], 1, true);
}

function isUnlockedSource(n: Node): boolean {
  return n.ninput.length === 0 && n.noutput.length === 1 && n.unlocked;
}
function isSource(n: Node): boolean {
  return n.ninput.length === 0 && n.noutput.length === 1;
}
function isSink(n: Node): boolean {
  return n.noutput.length === 0;
}
function isWildSink(n: Node): boolean {
  return n.noutput.length === 0 && n.ninput.length === 0;
}
const MAX_NEED = 9;
function nodeNeeds(target: Node, shape: Shape, max_need: number): boolean {
  if (isWildSink(target)) {
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
  assert(!isUnlockedSource(target));
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

type NodeType = ([Shape, Shape, Shape, Shape] | [Shape, Shape, Shape] | [Shape, Shape] | [Shape]);
const NODE_TYPES_DEF: NodeType[] = [
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
  [6, 8, 6, 3], // 3+6=7
  // TODO: more A+A = B kind of conversions?  analyze total cost in As of each of these steps
];
const NODE_TYPES_SIMPLE: NodeType[] = [
  // cost, output, input1, input2
  // [-1], // free sink
  [2, 0], // fist 0-generator free, later costs 2
  [0, 1, 0, 0], // 0+0=1
  [1, 2, 0, 1], // 0+1=2
  [2, 3, 0, 2], // 0+2=3
  [3, 4, 1, 2], // 1+2=4
  [4, 8, 3, 4], // 3+4=8
];
const VICTORY_NODE_TYPE: NodeType = [-1, -1, VICTORY_SHAPE];

const UNLOCK_COST = [
  3, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90
];
const UNLOCK_COST_DEFAULT = 100;

let flash_victory_at: number = 0;

type LevelDef = {
  node_types: NodeType[];
  w: number;
  h: number;
  seed: number;
  kfactor: number;
  num_sinks: number;
};
const LEVEL_DEFS: LevelDef[] = [{
  // 30x24x1 = 11?, slightly finicky
  // 30x24x2 = 13, slightly finicky, not as bad, but too many links
  // 30x24x3 = 10, has clean solution
  seed: 3,
  node_types: NODE_TYPES_SIMPLE,
  w: 30,
  h: 24,
  kfactor: 10,
  num_sinks: 1,
}, {
  // 3 = 18;
  // 4 = utter mess
  // 5 = 19, messy
  seed: 3,
  node_types: NODE_TYPES_DEF,
  w: 40,
  h: 30,
  kfactor: 10,
  num_sinks: 4,
}];
const LEVEL_DEF_UNL: LevelDef = {
  seed: -1,
  node_types: NODE_TYPES_DEF,
  w: 40,
  h: 30,
  kfactor: 10,
  num_sinks: 4,
};

type ScoreData = {
  seconds: number;
  links: number;
  largest_shape: number; // 0...9
  victory: number; // 0..2
};

class GameState {
  nodes: Node[] = [];
  links: Link[] = [];
  link_last_idx = 0;
  max_links = 1;
  made_victory_shape = false;
  did_victory_partial = false;
  did_victory_full = false;
  cur_victory_full = false;
  cur_victory_partial = false;
  wallet: Partial<Record<Shape, number>>;
  t: number = 0;
  dt: number = 0;
  viewport = {
    x: 0, y: 0, scale: 1,
  };
  unlocks_by_cost: Partial<Record<Shape, number>> = {};
  unlocks_total = 0;
  defer_updates = true;
  level_idx: number;
  level_def!: LevelDef;
  largest_shape = -1;

  allocLevel(level_def: LevelDef): void {
    this.level_def = level_def;
    let rand = randCreate(level_def.seed); // 3 = 18
    const W = level_def.w;
    const H = level_def.h;
    let points = poissonSample(rand, 3, level_def.kfactor, W, H);
    let v2points = points.map((idx) => {
      let x = idx % W;
      let y = (idx - x) / W;
      return vec2(x - W/2, y - H/2);
    });
    // place 4 victory sinks
    let sinks = [
      vec2(W/4, H/4),
      vec2(-W/4, H/4),
      vec2(W/4, -H/4),
      vec2(-W/4, -H/4),
    ];
    sinks = sinks.slice(0, level_def.num_sinks);
    // find points closest to those 4
    let closest = [0,0,0,0];
    for (let ii = 0; ii < v2points.length; ++ii) {
      let pt = v2points[ii];
      for (let jj = 0; jj < sinks.length; ++jj) {
        let spos = sinks[jj];
        if (v2distSq(spos, pt) < v2distSq(spos, v2points[closest[jj]])) {
          closest[jj] = ii;
        }
      }
    }
    for (let ii = 0; ii < sinks.length; ++ii) {
      this.addNode(v2points[closest[ii]], VICTORY_NODE_TYPE);
    }
    v2points = v2points.filter((v, idx) => !closest.includes(idx));

    v2points.sort((a: Vec2, b: Vec2) => {
      let da = v2lengthSq(a);
      let db = v2lengthSq(b);
      return da - db;
    });
    let { node_types } = level_def;
    for (let ii = 0; ii < v2points.length; ++ii) {
      let type = ii % node_types.length;
      this.addNode(v2points[ii], node_types[type]);
    }
    this.nodes[sinks.length].unlocked = true;

    this.unlocks_by_cost[2] = 1;
    this.unlocks_by_cost[3] = 2;
    this.unlocks_by_cost[4] = 3;
    for (let ii = 5; ii <= VICTORY_SHAPE; ++ii) {
      this.unlocks_by_cost[ii] = 4;
    }
  }
  constructor(level: number) {
    this.wallet = {};
    this.level_idx = level;

    let level_def = LEVEL_DEFS[level];
    if (!level_def) {
      level_def = clone(LEVEL_DEF_UNL);
      level_def.seed = 100 + level;
    }
    this.allocLevel(level_def);

    if (engine.DEBUG) {
      // this.unlockNode(this.nodes[4]);
      // this.unlockNode(this.nodes[5]);
      // this.unlockNode(this.nodes[6]);
      // this.unlockNode(this.nodes[7]);
      // this.unlockNode(this.nodes[8]);
      // this.unlockNode(this.nodes[9]);
      // this.unlockNode(this.nodes[10]);
      // this.unlockNode(this.nodes[11]);
      // this.unlockNode(this.nodes[12]);
      for (let ii = 0; ii < this.nodes.length; ++ii) {
        // this.unlockNode(this.nodes[ii]);
      }
      // this.addLink(0, 1);
      // this.addLink(0, 1);
      // this.selected = 1;
    }

    this.defer_updates = false;
    this.updateNodes();
  }
  addNode(pos: Vec2, type: NodeType): void {
    let ninput: Shape[] = [];
    let noutput: Shape[] = [];
    let cost = type[0];
    for (let ii = 1; ii < min(type.length, 2); ++ii) {
      if (type[ii] !== -1) {
        noutput.push(type[ii]);
      }
    }
    for (let ii = 2; ii < type.length; ++ii) {
      ninput.push(type[ii]);
    }
    let needs: Record<Shape, number> = {};
    for (let ii = 0; ii < ninput.length; ++ii) {
      needs[ninput[ii]] = (needs[ninput[ii]] || 0) + 1;
    }

    let index = this.nodes.length;
    let { num_sinks } = this.level_def;
    let extra_links = (index === 2+num_sinks || index === 5+num_sinks) ? 1 : 0;
    if (this.level_idx === 0 && index === 3+num_sinks) {
      extra_links = 1;
    }

    this.nodes.push({
      unlocked: cost === -1,
      index,
      cost,
      cost_paid: 0,
      extra_links,
      pos,
      screenpos: v2scale(vec2(), pos, SCALE),
      ninput,
      noutput,
      needs,
      nshapes: {},
      unfulfilled_raw: true,
      fulfilled_complete: true,
      satisfied_set: ninput.map(() => false),
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
      // this.updateNodes();
      return;
    }
    if (start > end) {
      let t = end;
      end = start;
      start = t;
    }
    let { links } = this;
    links.push({
      uid: ++this.link_last_idx,
      start, end,
      width: 1,
      length: v2dist(this.nodes[start].pos, this.nodes[end].pos),
      fullfilled: false,
      forward: {
        last_t: 0,
        lshapes: []
      },
      reverse: {
        last_t: 0,
        lshapes: [],
      },
    });
    this.updateNodes();
  }
  removeLink(link: Link): void {
    if (link.width > 1) {
      link.width--;
      // this.updateNodes();
      return;
    }
    let { links } = this;
    let idx = links.indexOf(link);
    assert(idx !== -1);
    ridx(links, idx);
    this.updateNodes();
  }

  unlockNode(node: Node): void {
    node.unlocked = true;
    this.unlocks_total++;
    this.unlocks_by_cost[node.cost] = (this.unlocks_by_cost[node.cost] || 0) + 1;
    // TODO: floater?
    this.max_links += node.extra_links + 1;
    if (!this.defer_updates) {
      playUISound('unlock');
    }
    this.updateNodes();
  }

  submitScore(): void {
    let score_data: ScoreData = {
      seconds: floor(this.t / 1000),
      links: this.links.length,
      largest_shape: max(0, this.largest_shape),
      victory: this.cur_victory_full ? 2 : this.cur_victory_partial ? 1 : 0,
    };
    score_systema.setScore(this.level_idx, score_data);
    score_systemb.setScore(this.level_idx, score_data);
  }

  addShape(node: Node, shape: Shape): void {
    playShapeSound(shape);
    if (isSink(node)) {
      // this.wallet[shape] = (this.wallet[shape] || 0) + 1;
      if (shape === VICTORY_SHAPE) {
        if (node.fulfilled_complete) {
          if (!this.did_victory_full) {
            this.did_victory_partial = true;
            this.did_victory_full = true;
            flash_victory_at = getFrameTimestamp();
            playUISound('victory');
            // modalDialog({
            //   title: 'Full Victory!',
            //   text: 'You win!',
            //   buttons: { ok: null },
            // });
          }
          this.cur_victory_partial = this.cur_victory_full = true;
          this.submitScore();
        } else {
          if (!this.did_victory_partial) {
            this.did_victory_partial = true;
            flash_victory_at = getFrameTimestamp();
            playUISound('victory_light');
            // modalDialog({
            //   title: 'Partial Victory!',
            //   text: 'You win!',
            //   buttons: { ok: null },
            // });
          }
          this.cur_victory_partial = true;
          this.cur_victory_full = false;
          this.submitScore();
        }
      }
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
        this.unlockNode(node);
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

    let eff_width = link.width * 2 - 1;
    let time_since_emit_allowed = (t - traffic.last_t) - traveltime/eff_width;
    if (time_since_emit_allowed >= 0 && lshapes.length < eff_width && !isUnlockedSource(nodeb)) {
      // potentially emit
      let emit = -1;
      if (isUnlockedSource(nodea)) {
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
    return ((UNLOCK_COST[count] || UNLOCK_COST_DEFAULT) + this.unlocks_total) * GAMESPEED_SCALE;
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
          if (shape === VICTORY_SHAPE && !this.made_victory_shape) {
            flash_victory_at = getFrameTimestamp();
            this.made_victory_shape = true;
          }
          if (shape > this.largest_shape) {
            this.largest_shape = max(this.largest_shape, shape);
            this.submitScore();
          }
          nshapes[shape] = (nshapes[shape] || 0) + 1;
        }
      }
    }
  }

  tick(dt: number): void {
    if (keyDown(KEYS.SHIFT)) {
      dt *= 10;
    }
    this.dt = dt;
    let { links, nodes } = this;
    if (links.length) {
      this.t += dt;
    }
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

  nodeUnfulfilledRaw(node: Node): boolean {
    let { links, nodes } = this;
    if (isSource(node) || !node.unlocked) {
      return false;
    }
    let inputs_satisfied: Record<Shape, boolean> = {};
    for (let ii = 0; ii < links.length; ++ii) {
      let link = links[ii];
      if (link.start === node.index) {
        let other = nodes[link.end];
        for (let jj = 0; jj < other.noutput.length; ++jj) {
          inputs_satisfied[other.noutput[jj]] = true;
        }
      } else if (link.end === node.index) {
        let other = nodes[link.start];
        for (let jj = 0; jj < other.noutput.length; ++jj) {
          inputs_satisfied[other.noutput[jj]] = true;
        }
      }
    }
    for (let ii = 0; ii < node.ninput.length; ++ii) {
      let shape = node.ninput[ii];
      if (!inputs_satisfied[shape]) {
        return true;
      }
    }
    return false;
  }

  updateNodes(): void {
    if (this.defer_updates) {
      return;
    }

    // Update anything that only needs to change upon topography changes
    let { nodes, links } = this;
    let walk = [];
    for (let ii = 0; ii < nodes.length; ++ii) {
      let node = nodes[ii];
      node.unfulfilled_raw = this.nodeUnfulfilledRaw(node);
      for (let jj = 0; jj < node.satisfied_set.length; ++jj) {
        node.satisfied_set[jj] = false;
      }
      if (node.unlocked && isSource(node)) {
        node.fulfilled_complete = true;
        walk.push(node);
      } else {
        node.fulfilled_complete = false;
      }
    }
    for (let ii = 0; ii < links.length; ++ii) {
      let link = links[ii];
      link.fullfilled = false;
    }
    links = links.slice(0);
    let did_anything = true;
    while (did_anything) {
      did_anything = false;
      for (let ii = links.length - 1; ii >= 0; --ii) {
        let link = links[ii];
        let nodea = nodes[link.start];
        let nodeb = nodes[link.end];
        let from;
        let other;
        if (nodea.fulfilled_complete) {
          from = nodea;
          other = nodeb;
          link.fullfilled = true;
        } else if (nodeb.fulfilled_complete) {
          from = nodeb;
          other = nodea;
          link.fullfilled = true;
        }
        if (from) {
          assert(other);
          for (let jj = 0; jj < from.noutput.length; ++jj) {
            let shape = from.noutput[jj];
            for (let kk = 0; kk < other.ninput.length; ++kk) {
              if (shape === other.ninput[kk]) {
                other.satisfied_set[kk] = true;
              }
            }
          }
          let good = true;
          for (let kk = 0; kk < other.ninput.length; ++kk) {
            if (!other.satisfied_set[kk]) {
              good = false;
            }
          }
          if (good) {
            other.fulfilled_complete = true;
          }
          ridx(links, ii);
          did_anything = true;
        }
      }
    }
  }

  selected = -1;
}
let game_state: GameState;

const NODE_W = 200;
const NODE_H = NODE_W;
const NW2 = NODE_W / 2;
const NH2 = NODE_H / 2;
const ICON_W = 32;
const ARROW_W = 38;
const ICON_PAD = 2;
const NODE_PAD = 9;
const LINE_W = 8;
const LINE_SHIFT = NODE_H / 2 - ICON_W/2;

const SHAPE_XOFFS: Partial<Record<Shape, number>> = {
  0: -3, // tri
  1: 0.6,
  4: 1.5, // hex
};
const SHAPE_YOFFS: Partial<Record<Shape, number>> = {
  3: -2, // pent
  6: -1, // rounded tri
};

function drawShapeCount(x: number, y: number, z: number, shape: Shape, count?: number, scale?: number): void {
  scale = scale || 1;
  symbolfont.draw({
    x: x + (1 + (SHAPE_XOFFS[shape] || 0)) * scale, y: y + (-2 + (SHAPE_YOFFS[shape] || 0)) * scale, z,
    size: ICON_W * scale,
    align: ALIGN.HVCENTER,
    text: SHAPE_LABELS[shape],
    style: SHAPE_STYLE[shape],
  });
  if (count !== undefined) {
    symbolfont.draw({
      x: x - ICON_W/2*scale, y, z: z + 1, w: ICON_W*scale,
      size: ICON_W*scale,
      align: ALIGN.HVCENTERFIT,
      text: String(count),
      style: number_style,
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
  let z = Z.LINKS;
  let color = islandjoy.colors[for_delete ? 12 : 1];
  if (is_invalid) {
    z++;
    color = islandjoy.colors[(getFrameTimestamp() % 200 > 100) ? 12 : 8];
  }
  drawLine(posa[0], posa[1], posb[0], posb[1], z, LINE_W, 1, color);
  if (width > 1) {
    let linew = LINE_W;
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
  drawLinkTraffic(link, posa[0], posa[1], posb[0], posb[1], link.forward);
  drawLinkTraffic(link, posb[0], posb[1], posa[0], posa[1], link.reverse);
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
      let same;
      let other1: Vec2;
      let other2: Vec2;
      if (v2same(p1, p3)) {
        same = p1;
        other1 = p2;
        other2 = p4;
      } else if (v2same(p1, p4)) {
        same = p1;
        other1 = p2;
        other2 = p3;
      } else if (v2same(p2, p3)) {
        same = p2;
        other1 = p1;
        other2 = p4;
      } else if (v2same(p2, p4)) {
        same = p2;
        other1 = p1;
        other2 = p3;
      }
      if (same) {
        if (sign(same[0] - other1![0]) === sign(other2![0] - same[0]) &&
          sign(same[1] - other1![1]) === sign(other2![1] - same[1])
        ) {
          // both going in opposite direcitons
          return false;
        }
        return true;
      } else {
        // no shared point, this is wrong doesn't catch  *---*  *---*
        return false;
      }
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

let flash_status_at: number = 0;
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
      symbolfont.draw({
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
      playUISound('button_click');
    } else if (!link_valid) {
      game_state.selected = -1;
      playUISound('error_chord');
    } else if (game_state.selected === link_target) {
      game_state.selected = -1;
      playUISound('link_deselect');
    } else if (!game_state.hasFreeLinks()) {
      // statusPush('Need more Z !');
      flash_status_at = getFrameTimestamp();
      playUISound('error_chord');
    } else if (nodePotentiallyNeeds(nodes[link_target], nodes[game_state.selected]) ||
      nodes[link_target].unlocked && nodePotentiallyNeeds(nodes[game_state.selected], nodes[link_target])
    ) {
      assert(link_target !== -1);
      // try to make link
      game_state.addLink(game_state.selected, link_target);
      game_state.selected = -1;
      playUISound('link_make');
    } else {
      // invalid
      game_state.selected = link_target;
      playUISound('button_click');
    }
  } else if (game_state.selected !== -1) {
    if (click() || keyDownEdge(KEYS.ESC)) {
      playUISound('link_deselect');
      game_state.selected = -1;
    }
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
        let link_key = `link${link.uid}`;
        let spot_ret = spot({
          key: link_key,
          x: mouse_pos[0] - 1,
          y: mouse_pos[1] - 1,
          w: 2,
          h: 2,
          def: SPOT_DEFAULT_BUTTON,
          sound_button: 'link_break',
        });
        let { focused, ret } = spot_ret;
        if (focused) {
          last_link = link_key;
          drawLinkPos(2, nodea.screenpos, nodeb.screenpos, true, true, false);
          symbolfont.draw({
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

let lock_style = fontStyle(null, {
  glow_inner: -2.5,
  glow_outer: 2,
  glow_color: 0x00000080,
  color: islandjoy.font_colors[12],
});

// let lock_style_victory = fontStyle(null, {
//   glow_inner: -2.5,
//   glow_outer: 2,
//   glow_color: 0x00000080,
//   color: islandjoy.font_colors[8],
// });

function anyUnlockedProvides(shape: Shape): boolean {
  let { nodes } = game_state;
  for (let ii = 0; ii < nodes.length; ++ii) {
    let node = nodes[ii];
    if (node.unlocked) {
      let { noutput } = node;
      if (noutput.includes(shape)) {
        return true;
      }
    }
  }
  return false;
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
      if (!(node.index === 0 && game_state.links.length === 0) && click(box)) {
        playUISound('link_deselect');
        game_state.selected = -1;
      }
    } else {
      let spot_ret = spot({
        ...box,
        key: `node${node.index}${node.unlocked}`,
        def: SPOT_DEFAULT_BUTTON,
        sound_button: null,
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
    } else if (!node.fulfilled_complete) {
      if (border_color !== COLOR_FACTORY_BORDER_ROLLOVER) {
        if (node.ninput[0] === VICTORY_SHAPE && !anyUnlockedProvides(VICTORY_SHAPE)) {
          border_color = COLOR_FACTORY_BORDER_LOCKED;
        } else {
          border_color = COLOR_FACTORY_BORDER_NOINPUT;
        }
      }
    }
  }
  // always eat clicks and mouseover, even if not interactable, do not allow clicking links behind
  mouseOver(box);

  if (x > camera2d.x1Real() ||
    y > camera2d.y1Real() ||
    x + NODE_W < camera2d.x0Real() ||
    y + NODE_H < camera2d.y0Real()
  ) {
    return;
  }


  //drawBox(box, sprite_bubble, 0.5, COLOR_FACTORY_BG, border_color);
  sprite_circle.drawDualTint({
    ...box,
    color: /*node.noutput[0] === VICTORY_SHAPE ?
      COLOR_FACTORY_BG_VICTORY :*/
      node.unlocked ? COLOR_FACTORY_BG :
      COLOR_FACTORY_BG_LOCKED,
    color1: border_color,
  });
  z+=4;

  let { ninput, noutput, nshapes } = node;

  let things = ninput.length + noutput.length;
  let arrow = true;
  if (isSink(node)) {
    arrow = false;
    // things++;

    let ss = 1.75;
    symbolfont.draw({
      x, y, z: z - 3.5, w, h: h * 0.75,
      size: ICON_W * ss,
      align: ALIGN.HVCENTER,
      text: '↓', // arrow down arrow
      style: SHAPE_STYLE[VICTORY_SHAPE],
      // alpha: 0.75,
    });
    y += h/8;

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
  let yoffs = 0;
  if (!node.unlocked) {
    y += NODE_PAD;
    h -= NODE_PAD * 2;
    h /= 2;
    // Draw cost
    let total = game_state.unlockCost(node);

    let ss = 1.75;
    symbolfont.draw({
      x, y: y + 8, z: z - 3, w, h: h * 2,
      size: ICON_W * ss,
      align: ALIGN.HVCENTER,
      text: 'Y', // Lock icon
      style: /*node.noutput[0] === VICTORY_SHAPE ? lock_style_victory : */lock_style,
      alpha: 0.75,
    });
    drawShapeCount(x + w/2, y + h*0.35, z - 2, node.cost, total - node.cost_paid, ss);

    // draw reward
    y += h * 1.29;
    symbolfont.draw({
      x: x + w/2, y: y + 16, z,
      size: ICON_W * scale,
      align: ALIGN.HCENTER,
      text: `+${1 + node.extra_links} Z`,
      color: islandjoy.font_colors[1],
    });
  } else if (is_converter) {
    y += NODE_PAD;
    yoffs = 16;
    h -= NODE_PAD * 2;
    h /= 2;
  }

  y += yoffs;

  for (let ii = 0; ii < ninput.length; ++ii) {
    let shape = ninput[ii];
    symbolfont.draw({
      x: xx, y, z, w: ICON_W * scale, h,
      size: ICON_W * scale,
      align: ALIGN.HVCENTER,
      text: SHAPE_LABELS[shape],
      style: SHAPE_STYLE[shape],
    });
    xx += (ICON_W + ICON_PAD) * scale;
  }
  if (arrow) {
    symbolfont.draw({
      x: xx, y, z, w: ARROW_W * scale, h,
      size: ICON_W * scale,
      align: ALIGN.HVCENTER,
      text: '→',
      style: arrow_style,
    });
    xx += (ARROW_W + ICON_PAD) * scale;
  }
  for (let ii = 0; ii < noutput.length; ++ii) {
    let shape = noutput[ii];
    symbolfont.draw({
      x: xx, y, z, w: ICON_W * scale, h,
      size: ICON_W * scale,
      align: ALIGN.HVCENTER,
      text: SHAPE_LABELS[shape],
      style: SHAPE_STYLE[shape],
    });
    xx += (ICON_W + ICON_PAD) * scale;
  }
  // if (isWildSink(node)) {
  //   symbolfont.draw({
  //     x: xx, y, z, w: ICON_W * scale, h,
  //     size: ICON_W * scale,
  //     align: ALIGN.HVCENTER,
  //     text: '$',
  //     color: islandjoy.font_colors[8],
  //   });
  //   xx += (ICON_W + ICON_PAD) * scale;
  // }
  y -= yoffs;
  if (is_converter && node.unlocked) {
    y += h;
    //drawLine(x + NODE_PAD + 1.5, y, x + w - (NODE_PAD + 1.5), y, z, 1, 1, islandjoy.colors[15]);

    let keys = [];
    for (let ii = 0; ii < ninput.length; ++ii) {
      let shape = ninput[ii];
      if (nshapes[shape] !== undefined && keys.indexOf(shape) === -1) {
        keys.push(shape);
      }
    }
    for (let ii = 0; ii < noutput.length; ++ii) {
      let shape = noutput[ii];
      if (nshapes[shape] !== undefined && keys.indexOf(shape) === -1) {
        keys.push(shape);
      }
    }
    things = keys.length;
    xx = x + (w - (things * (ICON_W + ICON_PAD) - ICON_PAD)) / 2;
    for (let ii = 0; ii < keys.length; ++ii) {
      let shape = keys[ii];
      let count = nshapes[shape];
      drawShapeCount(xx + ICON_W/2, y + h/2, z, shape, count);
      xx += ICON_W + ICON_PAD;
    }
  }
}

const WALLET_W = 200;
const WALLET_H = 54;
const WALLET_BORDER = 4;
const WALLET_PAD = 16;
let temp_color = vec4();
function drawWallet(): void {
  let { max_links } = game_state;
  let link_count = game_state.linkCount();
  let color = islandjoy.colors[15];
  let scale = 1;
  if (link_count === max_links) {
    color = islandjoy.colors[12];
    let dt = getFrameTimestamp() - flash_status_at;
    if (flash_status_at && dt < 1000) {
      scale = 1 + 0.5 * abs(sin(dt / 1000 * PI));
      color = v4lerp(temp_color, abs(sin(dt*0.015)), color, islandjoy.colors[9]);
    }
  }

  const x0 = camera2d.x0() + (camera2d.w() - WALLET_W * scale) / 2;
  const y0 = camera2d.y1() - WALLET_H * scale;
  let z = Z.WALLET;
  let y = y0 + WALLET_PAD * scale;
  let any = false;

  // links
  if (link_count) {
    symbolfont.draw({
      x: x0,
      y, z,
      w: WALLET_W/2 * scale,
      h: ICON_W * scale,
      size: ICON_W * scale,
      align: ALIGN.HRIGHT | ALIGN.VCENTER,
      text: `${link_count} / ${max_links}`,
      color: islandjoy.font_colors[link_count === max_links ? 12 : 0],
    });
    symbolfont.draw({
      x: x0 + (WALLET_W/2 + WALLET_PAD) * scale,
      y, z,
      h: ICON_W * scale,
      size: ICON_W * scale,
      align: ALIGN.VCENTER,
      text: 'Z',
      color: islandjoy.font_colors[1],
    });
    any = true;
  }

  if (any) {
    drawBox({
      x: x0 - WALLET_BORDER * scale, y: y0 - WALLET_BORDER * scale, z,
      w: (WALLET_W + WALLET_BORDER * 2) * scale, h: 500,
    }, sprite_bubble, 0.5, islandjoy.colors[11], color);
  }

  // let x = x0;
  // let row = 0;
  // for (let key in wallet) {
  //   let shape = Number(key);
  //   let count = wallet[key];
  //   if (row === 4) {
  //     x = x0;
  //     y += ICON_W + WALLET_PAD;
  //     row = 0;
  //   }
  //   drawShapeCount(x + ICON_W/2, y + ICON_W/2, z+1, shape, count);
  //   any = true;
  //   x += ICON_W + WALLET_PAD;
  //   row++;
  // }
  // y += ICON_W + WALLET_PAD/2;

  // if (any) {
  //   drawBox({
  //     x: x0 - WALLET_BORDER, y: y0 - 500, z,
  //     w: WALLET_W + WALLET_BORDER + 500, h: y - y0 + WALLET_BORDER + 500,
  //   }, sprite_bubble, 0.5, islandjoy.colors[11], islandjoy.colors[0]);
  // }
}


const VICTORY_W = 230;
const VICTORY_H = 61;
const VICTORY_BORDER = 16;
const VICTORY_PAD = 4;
function drawVictory(): void {
  if (engine.DEBUG && !flash_victory_at && false) {
    game_state.did_victory_full = true;
    game_state.made_victory_shape = true;
    flash_victory_at = getFrameTimestamp();
  }
  let { did_victory_partial, did_victory_full, made_victory_shape } = game_state;
  if (!made_victory_shape) {
    return;
  }
  let color = islandjoy.colors[15];
  let scale = 1;
  let dt = getFrameTimestamp() - flash_victory_at;
  if (flash_victory_at && dt < 1000) {
    scale = 1 + 0.5 * abs(sin(dt / 1000 * PI));
    // color = v4lerp(temp_color, abs(sin(dt*0.015)), color, islandjoy.colors[9]);
    if (did_victory_full) {
      symbolfont.draw({
        x: camera2d.x0(), y: camera2d.y0(), z: 2000,
        w: camera2d.w(),
        h: camera2d.h(),
        size: (scale - 1) * 900,
        align: ALIGN.HVCENTER,
        text: SHAPE_LABELS[VICTORY_SHAPE],
        style: SHAPE_STYLE[VICTORY_SHAPE],
      });
    }
  }

  const x0 = camera2d.x0() + (camera2d.w() - VICTORY_W * scale) / 2;
  const y0 = camera2d.y0() + VICTORY_PAD * scale;
  let z = Z.WALLET + 10;
  let y = y0 + 12;

  let x = x0 + VICTORY_BORDER * scale;
  let circle_extra = ICON_W * 0.5 * scale;
  sprite_circle2.drawDualTint({
    x: x - circle_extra, y: y - circle_extra, z: z - 1,
    w: ICON_W * scale + circle_extra * 2,
    h: ICON_W * scale + circle_extra * 2,
    color: COLOR_FACTORY_BG,
    color1: COLOR_FACTORY_BORDER_NOINPUT,
  });
  symbolfont.draw({
    x, y: y + scale * 3, z,
    w: ICON_W * scale,
    h: ICON_W * scale,
    size: ICON_W * scale,
    align: ALIGN.HVCENTER,
    text: SHAPE_LABELS[VICTORY_SHAPE],
    style: style_silver,
  });
  x += (ICON_W + VICTORY_PAD + 18) * scale;
  symbolfont.draw({
    x, y, z,
    w: ICON_W * scale,
    h: ICON_W * scale,
    size: ICON_W * scale * 2,
    align: ALIGN.HVCENTER,
    text: did_victory_partial ? '✔' : '✘',
    color: islandjoy.font_colors[did_victory_partial ? 7 : 10],
  });
  x += (ICON_W + VICTORY_PAD) * scale * 2;

  sprite_circle2.drawDualTint({
    x: x - circle_extra, y: y - circle_extra, z: z - 1,
    w: ICON_W * scale + circle_extra * 2,
    h: ICON_W * scale + circle_extra * 2,
    color: COLOR_FACTORY_BG,
    color1: COLOR_FACTORY_BORDER_ACTIVE,
  });
  symbolfont.draw({
    x, y: y + scale * 3, z,
    w: ICON_W * scale,
    h: ICON_W * scale,
    size: ICON_W * scale,
    align: ALIGN.HVCENTER,
    text: SHAPE_LABELS[VICTORY_SHAPE],
    style: SHAPE_STYLE[VICTORY_SHAPE],
  });
  x += (ICON_W + VICTORY_PAD + 18) * scale;
  symbolfont.draw({
    x, y, z,
    w: ICON_W * scale,
    h: ICON_W * scale,
    size: ICON_W * scale * 2,
    align: ALIGN.HVCENTER,
    text: did_victory_full ? '✔' : '✘',
    color: islandjoy.font_colors[did_victory_full ? 7 : 10],
  });
  x += (ICON_W + VICTORY_PAD) * scale * 2;

  drawBox({
    x: x0 - VICTORY_BORDER * scale, y: y0 - 500, z: z - 2,
    w: (VICTORY_W + VICTORY_BORDER * 2) * scale, h: 500 + (VICTORY_H + VICTORY_BORDER) * scale,
  }, sprite_bubble, 0.5, islandjoy.colors[11], color);
}

let force_show_menu = engine.DEBUG;
function statePlay(dt: number): void {
  camera2d.setAspectFixed2(game_width, game_height);
  gl.clearColor(islandjoy.colors[4][0], islandjoy.colors[4][1], islandjoy.colors[4][2], 1);

  game_state.tick(dt);

  let { nodes, links, viewport } = game_state;

  drawWallet();
  drawVictory();

  statusTick({
    x: camera2d.x0(), y: 0, w: camera2d.w(), h: camera2d.y1() - WALLET_H,
    z: Z.STATUS,
    pad_bottom: 10,
    pad_top: 10,
  });

  const button_h = 128;
  if (game_state.level_idx !== 0 || game_state.made_victory_shape || force_show_menu) {
    if (buttonText({
      x: 0, y: camera2d.y1() - button_h,
      w: button_h, h: button_h,
      font_height: button_h * 0.5,
      font: symbolfont,
      text: 'V', // menu
    })) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      stateLevelSelectInit();
    }
  }

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
    if (viewport.scale > 4) {
      viewport.scale = 4;
    }
  }

  if (keyDownEdge(KEYS.ESC)) {
    force_show_menu = true;
  }
}

let cur_level_idx = 0;
function playInit(): void {
  game_state = new GameState(cur_level_idx);
  engine.setState(statePlay);
}

const MAX_LEVEL = 100;

let style_link = fontStyleColored(null, islandjoy.font_colors[1]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ColumnDef = any;
function drawScoreLink(obj: {
  value: string | number;
  x: number; y: number; z: number; w: number; h: number;
  size: number;
  column: ColumnDef;
  use_style: FontStyle; header: boolean;
}): void {
  let { column, x, y, z, w, h, size, value, use_style, header } = obj;
  let { align } = column;
  if (align === undefined) {
    align = font.ALIGN.HVCENTERFIT;
  }

  let str = String(value);
  symbolfont.drawSizedAligned(header ? style_link : use_style, x, y, z, size, align, w, h, str);
}

let style_trophy = fontStyleColored(null, islandjoy.font_colors[8]);
function drawScoreProgress(obj: {
  value: number;
  x: number; y: number; z: number; w: number; h: number;
  size: number;
  column: ColumnDef;
  use_style: FontStyle; header: boolean;
}): void {
  let { column, x, y, z, w, h, size, value, use_style, header } = obj;
  let { align } = column;
  if (align === undefined) {
    align = font.ALIGN.HVCENTERFIT;
  }

  let str = String(value);
  if (header) {
    symbolfont.drawSizedAligned(header ? style_trophy : use_style, x, y, z, size, align, w, h, str);
  } else {
    if (value < 20) {
      symbolfont.drawSizedAligned(SHAPE_STYLE[value], x, y, z, size, align, w, h, SHAPE_LABELS[value] || String(value));
    } else if (value === 21) {
      let p = {
        x: x + (w - h) / 2, y, z,
        w: h,
        h: h,
        color: COLOR_FACTORY_BG,
        color1: COLOR_FACTORY_BORDER_NOINPUT,
        nozoom: true,
      };
      sprite_circle2.drawDualTint(p);
      symbolfont.drawSizedAligned(style_silver, x, y, z+1,
        size * 0.8, align, w, h, SHAPE_LABELS[VICTORY_SHAPE]);
    } else {
      let p = {
        x: x + (w - h) / 2, y, z,
        w: h,
        h: h,
        color: COLOR_FACTORY_BG,
        color1: COLOR_FACTORY_BORDER_ACTIVE,
        nozoom: true,
      };
      sprite_circle2.drawDualTint(p);
      symbolfont.drawSizedAligned(SHAPE_STYLE[VICTORY_SHAPE], x, y, z+1,
        size * 0.8, align, w, h, SHAPE_LABELS[VICTORY_SHAPE]);
    }
  }
}

const SCORE_COLUMNSB: ColumnDef[] = [
  // widths are just proportional, scaled relative to `width` passed in
  { name: '', width: 12, align: ALIGN.HFIT | ALIGN.HRIGHT | ALIGN.VCENTER },
  { name: '', width: 60, align: ALIGN.HFIT | ALIGN.VCENTER }, // Name
  { name: '', width: 12, draw: drawScoreProgress }, // Progress
  { name: '', width: 24 }, // Time
//  { name: 'Z', width: 12, draw: drawScoreLink }, // Link
];
const SCORE_COLUMNSA: ColumnDef[] = [
  // widths are just proportional, scaled relative to `width` passed in
  { name: '', width: 12, align: ALIGN.HFIT | ALIGN.HRIGHT | ALIGN.VCENTER },
  { name: '', width: 60, align: ALIGN.HFIT | ALIGN.VCENTER }, // Name
  { name: '', width: 12, draw: drawScoreProgress }, // Progress
  // { name: '', width: 24 }, // Time
  { name: 'Z', width: 12, draw: drawScoreLink }, // Link
];
const style_score = fontStyleColored(null, islandjoy.font_colors[0]);
const style_me = fontStyleColored(null, islandjoy.font_colors[8]);
const style_header = fontStyleColored(null, islandjoy.font_colors[1]);
function pad2(v: number): string {
  return `0${v}`.slice(-2);
}
function myScoreToRowB(row: unknown[], score: ScoreData): void {
  let seconds = score.seconds;
  let s = (seconds % 60);
  seconds -= s;
  let m = seconds / 60;
  row.push(score.victory ? 20 + score.victory : score.largest_shape,
    `${m}:${pad2(s)}`);
}

function myScoreToRowA(row: unknown[], score: ScoreData): void {
  row.push(score.victory ? 20 + score.victory : score.largest_shape,
    score.links);
}

function stateLevelSelect(): void {
  camera2d.setAspectFixed(1000, 1000);
  camera2d.shift(0, -camera2d.y0());
  const TITLE_H = 64;
  const PAD = 16;
  let x = 0;
  let y = 0;

  const button_h = 100;
  const font_height = button_h * 0.75;
  const arrow_inset = 240;
  if (buttonText({
    x: x + arrow_inset, y,
    w: button_h, h: button_h, font_height, font: symbolfont,
    text: '←',
    disabled: cur_level_idx === 0,
  })) {
    cur_level_idx--;
    score_systema.forceRefreshScores(cur_level_idx);
    score_systemb.forceRefreshScores(cur_level_idx);
  }
  if (buttonWasFocused() && cur_level_idx > 0) {
    score_systema.prefetchScores(cur_level_idx - 1);
    score_systemb.prefetchScores(cur_level_idx - 1);
  }

  if (buttonText({
    x: 1000 - button_h - arrow_inset, y,
    w: button_h, h: button_h, font_height, font: symbolfont,
    text: '→',
    disabled: cur_level_idx === MAX_LEVEL - 1,
  })) {
    cur_level_idx++;
    score_systema.forceRefreshScores(cur_level_idx);
    score_systemb.forceRefreshScores(cur_level_idx);
  }
  if (buttonWasFocused() && cur_level_idx < MAX_LEVEL - 1) {
    score_systema.prefetchScores(cur_level_idx + 1);
    score_systemb.prefetchScores(cur_level_idx + 1);
  }

  y += (button_h - TITLE_H) / 2;

  symbolfont.draw({
    x, y, w: 1000,
    align: ALIGN.HCENTER,
    size: TITLE_H,
    text: cur_level_idx < 2 ? `${cur_level_idx + 1} / 2` : `${cur_level_idx + 1} / ∞`,
  });
  y += TITLE_H + (button_h - TITLE_H) / 2;

  let has_score = score_systema.hasScore(cur_level_idx);

  const button_y = camera2d.y1() - button_h;
  const W = 1000;
  const H = button_y;
  let pad = 24;
  scoresDraw({
    score_system: score_systema,
    x: pad, width: (W-pad)/2 - pad * 2,
    y, height: H - y,
    z: Z.UI,
    size: 24,
    line_height: 24+8,
    level_index: cur_level_idx,
    columns: SCORE_COLUMNSA,
    scoreToRow: myScoreToRowA,
    style_score,
    style_me,
    style_header,
    color_line: islandjoy.colors[2],
    color_me_background: islandjoy.colors[11],
    allow_rename: true,
  });

  scoresDraw({
    score_system: score_systemb,
    x: W/2 + pad/2, width: (W-pad)/2 - pad * 2,
    y, height: H - y,
    z: Z.UI,
    size: 24,
    line_height: 24+8,
    level_index: cur_level_idx,
    columns: SCORE_COLUMNSB,
    scoreToRow: myScoreToRowB,
    style_score,
    style_me,
    style_header,
    color_line: islandjoy.colors[2],
    color_me_background: islandjoy.colors[11],
    allow_rename: false,
  });


  y = button_y;
  if (game_state && game_state.level_idx === cur_level_idx) {
    if (buttonText({
      x: 500 - button_h - PAD/2,
      y,
      w: button_h, h: button_h, font_height, font: symbolfont,
      text: '←',
    })) {
      engine.setState(statePlay);
    }
    if (buttonText({
      x: 500 + PAD/2,
      y,
      w: button_h, h: button_h, font_height, font: symbolfont,
      text: 'R',
    })) {
      playInit();
    }
  } else {
    if (buttonText({
      x: 500 - button_h/2,
      y,
      w: button_h, h: button_h, font_height, font: symbolfont,
      text: has_score ? 'R' : 'P',
    })) {
      playInit();
    }
  }
}

function stateLevelSelectInit(): void {
  force_show_menu = true;
  engine.setState(stateLevelSelect);
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
    ui_sprites: {
      ...ui_sprites,
      button: { ws: [63, 2, 63], hs: [128] },
      button_rollover: { ws: [63, 2, 63], hs: [128] },
      button_down: { ws: [63, 2, 63], hs: [128] },
      button_disabled: { ws: [63, 2, 63], hs: [128] },
    },
    do_borders: false,
    line_mode: LINE_ALIGN,
    show_fps: false,
    ui_sounds: {
      rollover: { file: 'rollover', volume: 0.1 },
      link_make: 'link_make',
      link_deselect: 'button2',
      link_break: 'button3',
      error_chord: 'error_chord',
      unlock: 'unlock',
      victory: 'victory',
      victory_light: 'victory_light',
    },
  })) {
    return;
  }

  gl.clearColor(islandjoy.colors[4][0], islandjoy.colors[4][1], islandjoy.colors[4][2], 1);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  font = engine.font;
  symbolfont = fontCreate(require('./img/font/ld53.json'), 'font/ld53');
  statusSetFont(symbolfont);

  for (let ii = 0; ii < sounds.length; ++ii) {
    let list = sounds[ii];
    for (let jj = 0; jj < list.length; ++jj) {
      soundLoad(list[jj]);
    }
  }

  // ui.scaleSizes(13 / 32);
  // ui.setFontHeight(8);
  settings.runTimeDefault('volume_music', 0.5);

  init();

  const ENCODE = 1000000;
  const ENCODE_LINKS = 1000;
  // max progress, min time, then min links
  function encodeScoreTime(score: ScoreData): number {
    let {
      seconds,
      links,
      largest_shape, // 0...9
      victory, // 0..2
    } = score;

    let progress = victory ? victory + 20 : largest_shape;
    let time = ENCODE - 1 - min(seconds, ENCODE-1);
    let linkv = ENCODE_LINKS - 1 - min(links, ENCODE_LINKS-1);
    return progress * ENCODE * ENCODE_LINKS + time * ENCODE_LINKS + linkv;
  }
  // max progress, min links, min time
  function encodeScoreLink(score: ScoreData): number {
    let {
      seconds,
      links,
      largest_shape, // 0...9
      victory, // 0..2
    } = score;

    let progress = victory ? victory + 20 : largest_shape;
    let time = ENCODE - 1 - min(seconds, ENCODE-1);
    let linkv = ENCODE_LINKS - 1 - min(links, ENCODE_LINKS-1);
    return progress * ENCODE * ENCODE_LINKS + linkv * ENCODE + time;
  }

  function parseScoreTime(value: number): ScoreData {
    let progress = floor(value / (ENCODE * ENCODE_LINKS));
    value -= progress * ENCODE * ENCODE_LINKS;
    let time = floor(value / ENCODE_LINKS);
    value -= time * ENCODE_LINKS;
    let links = ENCODE_LINKS - 1 - value;
    let seconds = ENCODE - 1 - time;
    let largest_shape = progress;
    let victory = progress === 22 ? 2 : progress === 21 ? 1 : 0;
    return {
      seconds,
      links,
      largest_shape,
      victory,
    };
  }
  function parseScoreLink(value: number): ScoreData {
    let progress = floor(value / (ENCODE * ENCODE_LINKS));
    value -= progress * ENCODE * ENCODE_LINKS;
    let links = floor(value / ENCODE);
    value -= links * ENCODE;
    links = ENCODE_LINKS - 1 - links;
    let time = value;
    let seconds = ENCODE - 1 - time;
    let largest_shape = progress;
    let victory = progress === 22 ? 2 : progress === 21 ? 1 : 0;
    return {
      seconds,
      links,
      largest_shape,
      victory,
    };
  }

  score_systema = scoreAlloc({
    score_to_value: encodeScoreLink,
    value_to_score: parseScoreLink,
    level_defs: MAX_LEVEL,
    score_key: 'LD53b'
  });
  score_systemb = scoreAlloc({
    score_to_value: encodeScoreTime,
    value_to_score: parseScoreTime,
    level_defs: MAX_LEVEL,
    score_key: 'LD53a'
  });

  let has_score = score_systema.hasScore(0);
  if (has_score) {
    force_show_menu = true;
  }

  if (engine.DEBUG) {
    // cur_level_idx = 1;
    // playInit();
    stateLevelSelectInit();
  } else {
    playInit();
  }
}

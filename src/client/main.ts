/*eslint global-require:off*/
// eslint-disable-next-line import/order
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('ld53'); // Before requiring anything else that might load from this

import assert from 'assert';
import * as camera2d from 'glov/client/camera2d';
import * as engine from 'glov/client/engine';
import { ALIGN, Font, fontStyle } from 'glov/client/font';
// import * as input from 'glov/client/input';
import {
  click,
  drag,
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
} from 'glov/client/ui';
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
  v2linePointDist,
  v2scale,
  v2sub,
  vec2,
} from 'glov/common/vmath';
import * as islandjoy from './islandjoy';

const COLOR_FACTORY_BG = islandjoy.colors[3];
// const COLOR_FACTORY_BORDER_LOCKED = islandjoy.colors[3];
const COLOR_FACTORY_BORDER_ACTIVE = islandjoy.colors[5];
// const COLOR_FACTORY_BORDER_NOINPUT = islandjoy.colors[9];
// const COLOR_FACTORY_BORDER_FULL = islandjoy.colors[12];
const COLOR_FACTORY_BORDER_SELECTED = islandjoy.colors[1];
const COLOR_FACTORY_BORDER_ROLLOVER = islandjoy.colors[0];

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
  index: number;
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
  return n.ninput.length === 0;
}
function isSink(n: Node): boolean {
  return n.noutput.length === 0;
}
function nodeNeeds(target: Node, shape: Shape): boolean {
  return target.ninput.indexOf(shape) !== -1;
}

function nodeNeeds2(target: Node, source: Node): number {
  assert(!isSource(target));
  if (source.nshapes) {
    for (let key in source.nshapes) {
      let shape = Number(key);
      let count = source.nshapes[key];
      if (count && nodeNeeds(target, shape)) {
        return shape;
      }
    }
  }
  return -1;
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


class GameState {
  nodes: Node[] = [];
  links: Link[] = [];
  wallet: Partial<Record<Shape, number>>;
  t: number = 0;
  dt: number = 0;
  viewport = {
    x: 0, y: 0, scale: 1,
  };
  constructor() {
    this.wallet = {
      1: 3,
      0: 4,
      2: 5,
      3: 4,
      4: 7,
      5: 6,
    };
    this.addNode(vec2(0, 0), [], [0]);
    this.addNode(vec2(4, 1), [1], []);
    this.addNode(vec2(2, -3), [0, 0], [1]);
    this.addLink(0, 2);
    this.addLink(0, 2);
    // this.addLink(2, 1);
  }
  addNode(pos: Vec2, ninput: Shape[], noutput: Shape[]): void {
    let needs: Record<Shape, number> = {};
    for (let ii = 0; ii < ninput.length; ++ii) {
      needs[ninput[ii]] = (needs[ninput[ii]] || 0) + 1;
    }

    this.nodes.push({
      index: this.nodes.length,
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
        last_t: this.t,
        lshapes: []
      },
      reverse: {
        last_t: this.t,
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
    node.nshapes[shape] = (node.nshapes[shape] || 0) + 1;
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

  tickLinkEmit(link: Link, nodea: Node, nodeb: Node, traffic: LinkTraffic): void {
    let { t } = this;
    let { lshapes } = traffic;
    let { length } = link;
    let traveltime = length / TRAVEL_SPEED;

    let time_since_emit_allowed = (t - traffic.last_t) - traveltime/link.width;
    if (time_since_emit_allowed >= 0 && lshapes.length < link.width && !isSource(nodeb)) {
      // potentially emit
      let emit = -1;
      if (isSource(nodea)) {
        assert.equal(nodea.noutput.length, 1);
        if (!isSink(nodeb) || nodeNeeds(nodeb, nodea.noutput[0])) {
          emit = nodea.noutput[0];
        }
      } else {
        emit = nodeNeeds2(nodeb, nodea);
        if (emit !== -1) {
          removeShape(nodea, emit);
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
  }

  hasFreeLinks(): boolean {
    return true;
  }

  tickNode(node: Node): void {
    let { ninput, noutput, needs, nshapes } = node;
    if (ninput.length && noutput.length) {
      // factory
      let satisfied = true;
      for (let shape in needs) {
        if (needs[shape] > (nshapes[shape] || 0)) {
          satisfied = false;
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
          nshapes[noutput[ii]] = (nshapes[noutput[ii]] || 0) + 1;
        }
      }
    }
  }

  tick(dt: number): void {
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


    for (let ii = 0; ii < links.length; ++ii) {
      let link = links[ii];
      let nodea = nodes[link.start];
      let nodeb = nodes[link.end];
      this.tickLinkEmit(link, nodea, nodeb, link.forward);
      this.tickLinkEmit(link, nodeb, nodea, link.reverse);
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

function drawShapeCount(x: number, y: number, z: number, shape: Shape, count?: number): void {
  font.draw({
    x, y, z,
    size: ICON_W,
    align: ALIGN.HVCENTER,
    text: SHAPE_LABELS[shape],
    color: islandjoy.font_colors[SHAPE_COLORS[shape]],
  });
  if (count !== undefined) {
    font.draw({
      x: x - ICON_W/2, y, z: z + 1, w: ICON_W,
      size: ICON_W,
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
function drawLinkPos(width: number, posa_in: Vec2, posb_in: Vec2, bdelta: boolean, for_delete: boolean): void {
  v2copy(posa, posa_in);
  v2copy(posb, posb_in);
  v2sub(delta, posa, posb);
  v2iNormalize(delta);
  v2addScale(posa, posa, delta, -LINE_SHIFT);
  if (bdelta) {
    v2addScale(posb, posb, delta, LINE_SHIFT);
  }
  drawLine(posa[0], posa[1], posb[0], posb[1], Z.LINKS, LINE_W, 1, islandjoy.colors[for_delete ? 12 : 1]);
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
  drawLinkPos(link.width, pa, pb, true, false);
  drawLinkTraffic(link, pa[0], pa[1], pb[0], pb[1], link.forward);
  drawLinkTraffic(link, pb[0], pb[1], pa[0], pa[1], link.reverse);
}

let mouse_pos = vec2();
let link_target: number;
let link_clicked: boolean;
function doLinking(): void {
  let { nodes, links } = game_state;
  if (game_state.selected !== -1) {
    let selnode = nodes[game_state.selected];

    if (link_target !== -1 && link_target !== game_state.selected) {
      let tnode = nodes[link_target];
      v2copy(mouse_pos, tnode.screenpos);

      let existing_link = game_state.findLink(selnode.index, link_target);
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

    drawLinkPos(1, selnode.screenpos, mouse_pos, false, false);
  }

  if (link_clicked) {
    if (game_state.selected === -1) {
      game_state.selected = link_target;
    } else if (game_state.selected === link_target) {
      game_state.selected = -1;
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
        let spot_ret = spot({
          key: 'link',
          x: mouse_pos[0] - 1,
          y: mouse_pos[1] - 1,
          w: 2,
          h: 2,
          def: SPOT_DEFAULT_BUTTON,
        });
        let { focused, ret } = spot_ret;
        if (focused) {
          drawLinkPos(2, nodea.screenpos, nodeb.screenpos, true, true);
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
  if (!did_link) {
    spot({
      key: 'link',
      x: -9e9,
      y: -9e9,
      w: 1,
      h: 1,
      def: SPOT_DEFAULT_BUTTON,
    });
  }
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

  if (game_state.hasFreeLinks()) {
    if (game_state.selected === node.index) {
      border_color = COLOR_FACTORY_BORDER_SELECTED;
    } else {
      let spot_ret = spot({
        ...box,
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
  } else {
    assert(game_state.selected === -1);
  }

  if (game_state.selected === node.index) {
    border_color = COLOR_FACTORY_BORDER_SELECTED;
  }

  drawBox(box, sprite_bubble, 0.5, COLOR_FACTORY_BG, border_color);
  z++;

  let { ninput, noutput, nshapes } = node;

  let things = ninput.length + noutput.length;
  let xx = x + (w - (things * (ICON_W + ICON_PAD) + ARROW_W)) / 2;
  let is_converter = ninput.length && noutput.length;
  if (is_converter) {
    y += NODE_PAD;
    h -= NODE_PAD * 2;
    h /= 2;
  }
  for (let ii = 0; ii < ninput.length; ++ii) {
    let shape = ninput[ii];
    font.draw({
      x: xx, y, z, w: ICON_W, h,
      size: ICON_W,
      align: ALIGN.HVCENTER,
      text: SHAPE_LABELS[shape],
      color: islandjoy.font_colors[SHAPE_COLORS[shape]],
    });
    xx += ICON_W + ICON_PAD;
  }
  font.draw({
    x: xx, y, z, w: ARROW_W, h,
    size: ICON_W,
    align: ALIGN.HVCENTER,
    text: '→',
  });
  xx += ARROW_W + ICON_PAD;
  for (let ii = 0; ii < noutput.length; ++ii) {
    let shape = noutput[ii];
    font.draw({
      x: xx, y, z, w: ICON_W, h,
      size: ICON_W,
      align: ALIGN.HVCENTER,
      text: SHAPE_LABELS[shape],
      color: islandjoy.font_colors[SHAPE_COLORS[shape]],
    });
    xx += ICON_W + ICON_PAD;
  }
  if (is_converter) {
    y += h;
    drawLine(x + NODE_PAD, y, x + w - NODE_PAD, y, z, 1, 1, islandjoy.colors[0]);

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
  let { wallet } = game_state;
  const x0 = camera2d.x1() - WALLET_W;
  const y0 = camera2d.y0();
  let z = Z.WALLET;
  let y = y0 + WALLET_PAD;

  // TODO: links

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
    x += ICON_W + WALLET_PAD;
    row++;
  }
  y += ICON_W + WALLET_PAD/2;

  drawBox({
    x: x0 - WALLET_BORDER, y: y0 - 500, z,
    w: WALLET_W + WALLET_BORDER + 500, h: y - y0 + WALLET_BORDER + 500,
  }, sprite_bubble, 0.5, islandjoy.colors[11], islandjoy.colors[0]);
}

function statePlay(dt: number): void {
  camera2d.setAspectFixed2(game_width, game_height);
  gl.clearColor(islandjoy.colors[4][0], islandjoy.colors[4][1], islandjoy.colors[4][2], 1);

  game_state.tick(dt);

  let { nodes, links, viewport } = game_state;

  drawWallet();

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
      viewport.scale *= 2;
    } else {
      viewport.scale /= 2;
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
  })) {
    return;
  }

  font = engine.font;

  // ui.scaleSizes(13 / 32);
  // ui.setFontHeight(8);

  init();

  playInit();
}

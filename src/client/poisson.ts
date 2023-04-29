import { ridx } from 'glov/common/util';

const { PI, ceil, cos, max, min, sin, sqrt } = Math;

type RandProvider = {
  range(mx: number): number;
  random(): number;
};

// Generates poisson sampled points inside of a width x height area with between radius and 2 * radius between each
// Return is encoded as `x + y * width`
export function poissonSample(rand: RandProvider, radius: number, k: number, width: number, height: number): number[] {
  const total_size = width * height;
  let ret: number[] = [];
  let peak_rsquared = radius * radius;
  let cell_bound = radius / sqrt(2);
  let cell_w = ceil(width / cell_bound);
  let cell_h = ceil(height / cell_bound);
  let cells = new Int16Array(cell_w * cell_h);
  let active: number[] = [];
  function emitSample(pos: number): void {
    let posx = pos % width;
    let posy = (pos - posx) / width;
    let cellidx = ((posx / cell_bound)|0) + ((posy / cell_bound)|0) * cell_w;
    ret.push(pos);
    cells[cellidx] = ret.length;
    active.push(pos);
  }
  emitSample(rand.range(total_size));

  // From https://www.jasondavies.com/poisson-disc/
  // Generate point chosen uniformly from spherical annulus between radius r and 2r from p.
  let nx: number = 0;
  let ny: number = 0;
  function generateAround(px: number, py: number): void {
    let θ = rand.random() * 2 * PI;
    let r = sqrt(rand.random() * 3 * peak_rsquared + peak_rsquared); // http://stackoverflow.com/a/9048443/64009
    nx = (px + r * cos(θ)) | 0;
    ny = (py + r * sin(θ)) | 0;
  }

  function near(): boolean {
    let n = 2;
    let x = nx / cell_bound | 0;
    let y = ny / cell_bound | 0;
    let x0 = max(x - n, 0);
    let y0 = max(y - n, 0);
    let x1 = min(x + n + 1, cell_w);
    let y1 = min(y + n + 1, cell_h);
    for (let yy = y0; yy < y1; ++yy) {
      let o = yy * cell_w;
      for (let xx = x0; xx < x1; ++xx) {
        let g = cells[o + xx];
        if (!g) {
          continue;
        }
        g = ret[g - 1];
        let gx = g % width;
        let gy = (g - gx) / width;
        let dsq = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy);
        if (dsq < peak_rsquared) {
          return true;
        }
      }
    }
    return false;
  }

  while (active.length) {
    let active_idx = rand.range(active.length);
    let pos = active[active_idx];
    ridx(active, active_idx);
    let posx = pos % width;
    let posy = (pos - posx) / width;
    for (let jj = 0; jj < k; ++jj) {
      generateAround(posx, posy);
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || near()) {
        continue;
      }
      emitSample(nx + ny * width);
    }
  }
  return ret;
}

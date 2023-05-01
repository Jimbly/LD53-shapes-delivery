// Portions Copyright 2023 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint-env browser */

import { VoidFunc } from 'glov/common/types';
import { fetch } from './fetch';

const PLAYER_NAME_KEY = 'ld.player_name';
const MAX_SCORES = 20000;

let player_name: string;
let lsd = (function (): Partial<Record<string, string>> {
  try {
    localStorage.setItem('test', 'test');
    localStorage.removeItem('test');
    return localStorage;
  } catch (e) {
    return {};
  }
}());

if (lsd[PLAYER_NAME_KEY]) {
  player_name = lsd[PLAYER_NAME_KEY]!;
} else {
  // eslint-disable-next-line newline-per-chained-call
  lsd[PLAYER_NAME_KEY] = player_name = `Anonymous ${Math.random().toString().slice(2, 8)}`;
}

let score_host = 'http://scores.dashingstrike.com';
if (window.location.host.indexOf('localhost') !== -1 ||
  window.location.host.indexOf('staging') !== -1) {
  score_host = 'http://scores.staging.dashingstrike.com';
}
if (window.location.href.startsWith('https://')) {
  score_host = score_host.replace(/^http:/, 'https:');
}
export function scoreGetPlayerName(): string {
  return player_name;
}

// TODO: refactor to use fetch() directly
function fetchJSON<T>(param: {
  url: string;
  success?: (o: T) => void;
  error?: (err: string) => void;
}): void {
  fetch({
    url: param.url,
    response_type: 'json',
  }, (err: string | undefined, resp: unknown) => {
    if (err) {
      if (param.error) {
        param.error(err);
      }
      return;
    }
    if (param.success) {
      param.success(resp as T);
    }
  });
}

export type LevelName = string;
export type LevelDef = {
  name?: LevelName;
};
type ScoreTypeInternal<ScoreType> = ScoreType & {
  submitted?: boolean;
};
type LevelDefInternal<ScoreType> = {
  name: LevelName;
  local_score?: ScoreTypeInternal<ScoreType>; // internal to score system
};
export type ScoreSystem<T> = ScoreSystemImpl<T>;
export type ScoreSystemParam<ScoreType> = {
  score_to_value: (s: ScoreType) => number;
  value_to_score: (v: number) => ScoreType;
  level_defs: LevelDef[];
  score_key: string;
};
type HighScoreListEntryRaw = {
  name: string;
  score: number;
};
type HighScoreListRaw = HighScoreListEntryRaw[];
export type HighScoreListEntry<ScoreType> = {
  name: string;
  score: ScoreType;
};
type HighScoreList<ScoreType> = HighScoreListEntry<ScoreType>[];
class ScoreSystemImpl<ScoreType> {
  score_to_value: (s: ScoreType) => number;
  value_to_score: (v: number) => ScoreType;
  level_defs: LevelDefInternal<ScoreType>[];
  SCORE_KEY: string;
  LS_KEY: string;
  constructor(param: ScoreSystemParam<ScoreType>) {
    this.score_to_value = param.score_to_value;
    this.value_to_score = param.value_to_score;
    this.level_defs = param.level_defs as LevelDefInternal<ScoreType>[]; // optional name filled below
    this.SCORE_KEY = param.score_key;
    this.LS_KEY = this.SCORE_KEY.toLowerCase();

    // TODO: only fetch local_score, don't actually query server for all scores
    for (let level_idx = 0; level_idx < this.level_defs.length; ++level_idx) {
      let ld = this.level_defs[level_idx];
      if (!ld.name) {
        if (this.level_defs.length === 1) {
          ld.name = 'the';
        } else {
          ld.name = String(level_idx);
        }
      }
      this.getScore(level_idx); // fetch .local_score for updatePlayerName to take advantage of
    }
  }

  high_scores: Partial<Record<LevelName, HighScoreList<ScoreType>>> = {};
  getHighScores(level: LevelName): HighScoreList<ScoreType> | null {
    return this.high_scores[level] || null;
  }

  private handleScoreResp(level: LevelName, scores: HighScoreListRaw): void {
    let list: HighScoreList<ScoreType> = [];
    scores.forEach((score) => {
      list.push({
        name: score.name,
        score: this.value_to_score(score.score),
      });
    });
    this.high_scores[level] = list;
  }
  private refreshScores(level: LevelName, changed_cb?: VoidFunc): void {
    fetchJSON({
      url: `${score_host}/api/scoreget?key=${this.SCORE_KEY}.${level}&limit=${MAX_SCORES}`,
      success: (scores: HighScoreListRaw) => {
        this.handleScoreResp(level, scores);
        changed_cb?.();
      }
    });
  }

  private clearScore(level: LevelName, old_player_name: string, cb?: VoidFunc): void {
    if (!old_player_name) {
      return;
    }
    fetchJSON({
      url: `${score_host}/api/scoreclear?key=${this.SCORE_KEY}.${level}&name=${old_player_name}`,
      success: cb,
    });
  }

  private submitScore(level: LevelName, score: ScoreType, cb?: VoidFunc): void {
    let high_score = this.score_to_value(score);
    if (!player_name) {
      return;
    }
    fetchJSON({
      url: `${score_host}/api/scoreset?key=${this.SCORE_KEY}.${level}&name=${player_name}&score=${high_score}`,
      success: (scores: HighScoreListRaw) => {
        this.handleScoreResp(level, scores);
        cb?.();
      }
    });
  }

  need_update = false;
  score_update_time = 0;
  updateHighScores(changed_cb?: VoidFunc): void {
    let now = Date.now();
    if (now - this.score_update_time > 5*60*1000 || this.need_update) {
      this.need_update = false;
      this.score_update_time = now;
      for (let level_idx in this.level_defs) {
        this.refreshScores(this.level_defs[level_idx].name, changed_cb);
      }
    } else {
      changed_cb?.();
    }
  }

  private saveScore(ld_in: LevelDef, obj_in: ScoreType, cb?: VoidFunc): void {
    let obj = obj_in as ScoreTypeInternal<ScoreType>;
    let ld = ld_in as LevelDefInternal<ScoreType>;
    ld.local_score = obj;
    let key = `${this.LS_KEY}.score_${ld.name}`;
    lsd[key] = JSON.stringify(obj);
    this.submitScore(ld.name, obj, function () {
      obj.submitted = true;
      if (obj === ld.local_score) {
        lsd[key] = JSON.stringify(obj);
      }
      cb?.();
    });
  }

  // TODO: these should be by name or index?
  hasScore(level_idx: number): boolean {
    return Boolean(this.getScore(level_idx));
  }

  getScore(level_idx: number): ScoreType | null {
    let ld = this.level_defs[level_idx];
    if (ld.local_score) {
      return ld.local_score; // allow calling each frame and getting cached version instead of spamming submits
    }
    let key = `${this.LS_KEY}.score_${ld.name}`;
    if (lsd[key]) {
      let ret = JSON.parse(lsd[key]!);
      if (!ret) {
        return null;
      }
      ld.local_score = ret;
      if (!ret.submitted) {
        this.saveScore(ld, ret);
      }
      return ret;
    }
    return null;
  }

  setScore(level_idx: number, score: ScoreType, cb?: VoidFunc): void {
    let ld = this.level_defs[level_idx];
    let encoded = this.score_to_value(score) || 0;
    let encoded_local = ld.local_score && this.score_to_value(ld.local_score) || 0;
    if (encoded > encoded_local) {
      this.saveScore(ld, score, cb);
    } else {
      cb?.();
    }
  }

  onUpdatePlayerName(old_name: string): void {
    this.level_defs.forEach((ld) => {
      if (ld.local_score) {
        this.clearScore(ld.name, old_name, () => {
          this.saveScore(ld, ld.local_score!, () => {
            this.need_update = true;
          });
        });
      }
    });
  }
}


let all_score_systems: ScoreSystem<any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

export function scoreAlloc<ScoreType>(param: ScoreSystemParam<ScoreType>): ScoreSystem<ScoreType> {
  let ret = new ScoreSystemImpl(param);
  all_score_systems.push(ret);
  return ret;
}

export function scoreFormatName(score: { name: string }): string {
  if (score.name.indexOf('Anonymous') === 0) {
    return score.name.slice(0, 'Anonymous'.length);
  }
  return score.name;
}

export function scoreUpdatePlayerName(new_player_name: string): void {
  if (new_player_name === player_name) {
    return;
  }
  let old_name = player_name;
  lsd[PLAYER_NAME_KEY] = player_name = new_player_name;

  if (old_name.startsWith('Anonymous')) {
    // Only wiping old scores if anonymous, so we can't delete other people's scores!
    for (let ii = 0; ii < all_score_systems.length; ++ii) {
      all_score_systems[ii].onUpdatePlayerName(old_name);
    }
  }
}

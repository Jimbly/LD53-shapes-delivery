import { vec4ColorFromIntColor } from 'glov/client/font';
import { vec4 } from 'glov/common/vmath';

export const font_colors = [
  0xffffffff,
  0x6df7c1ff,
  0x11adc1ff,
  0x606c81ff,
  0x393457ff,
  0x1e8875ff,
  0x5bb361ff,
  0xa1e55aff,
  0xf7e476ff,
  0xf99252ff,
  0xcb4d68ff,
  0x6a3771ff,
  0xc92464ff,
  0xf48cb6ff,
  0xf7b69eff,
  0x9b9c82ff,
];

export const colors = font_colors.map((a) => vec4ColorFromIntColor(vec4(), a));

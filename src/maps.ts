import { type Rect, type Vec, snap8 } from "./math";

export type Spawn = { x: number; y: number; inX: number; inY: number };

export type GameMap = {
  id: string;
  name: string;
  tile: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  walls: Rect[];
  spawns: Spawn[];
  starts: Vec[];
  cells: string[];
};

function parse(id: string, name: string, raw: string, tile = 32): GameMap {
  const rows = raw
    .trim()
    .split("\n")
    .map((l) => l.trimEnd());
  const cols = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((r) => r.padEnd(cols, " "));
  const h = cells.length;
  const walls: Rect[] = [];
  const spawns: Spawn[] = [];
  const starts: Vec[] = [];
  const cx = (cols * tile) / 2;
  const cy = (h * tile) / 2;

  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < cols) {
      if (cells[y][x] !== "#") {
        x++;
        continue;
      }
      let x2 = x;
      while (x2 < cols && cells[y][x2] === "#") x2++;
      walls.push({ x: x * tile, y: y * tile, w: (x2 - x) * tile, h: tile });
      x = x2;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y][x];
      const px = x * tile + tile / 2;
      const py = y * tile + tile / 2;
      if (c === "D") {
        const d = snap8(cx - px, cy - py);
        spawns.push({ x: px, y: py, inX: d.x || 0, inY: d.y || 1 });
      }
      if (c === "1" || c === "2") starts.push({ x: px, y: py });
    }
  }

  if (starts.length === 0) starts.push({ x: cx, y: cy });
  if (starts.length === 1) starts.push({ x: starts[0].x + 28, y: starts[0].y });

  return {
    id,
    name,
    tile,
    cols,
    rows: h,
    width: cols * tile,
    height: h * tile,
    walls,
    spawns,
    starts,
    cells,
  };
}

export const MAPS: GameMap[] = [
  parse(
    "open",
    "The Yard",
    `
########DD####################DD########
D                                      D
#                                      #
#                                      #
#                                      #
#                                      #
#                  12                  #
#                                      #
#                                      #
#                                      #
#                                      #
D                                      D
########DD####################DD########
`,
  ),
  parse(
    "pillars",
    "Pillars",
    `
########DD####################DD########
D                                      D
#      ####              ####          #
#                                      #
#              ####                    #
#                                      #
#                  12                  #
#                                      #
#                    ####              #
#                                      #
#          ####              ####      #
D                                      D
########DD####################DD########
`,
  ),
  parse(
    "cross",
    "The Cross",
    `
########DD####################DD########
D                                      D
#                                      #
#                ####                  #
#                ####                  #
#                ####                  #
#          ##############              #
#                  12                  #
#                ####                  #
#                ####                  #
#                ####                  #
D                                      D
########DD####################DD########
`,
  ),
  parse(
    "split",
    "Split Hall",
    `
########DD####################DD########
D                 ##                   D
#                 ##                   #
#                 ##                   #
#                 ##                   #
#                                      #
#         1                  2         #
#                                      #
#                 ##                   #
#                 ##                   #
#                 ##                   #
D                 ##                   D
########DD####################DD########
`,
  ),
  parse(
    "corners",
    "Corner Bunkers",
    `
########DD####################DD########
D                                      D
#  ######                      ######  #
#  ##                              ##  #
#  ##                              ##  #
#                                      #
#                  12                  #
#                                      #
#  ##                              ##  #
#  ##                              ##  #
#  ######                      ######  #
D                                      D
########DD####################DD########
`,
  ),
  parse(
    "ring",
    "The Ring",
    `
########DD####################DD########
D                                      D
#                                      #
#          ######      ######          #
#          ##              ##          #
#          ##              ##          #
#                  12                  #
#          ##              ##          #
#          ##              ##          #
#          ######      ######          #
#                                      #
D                                      D
########DD####################DD########
`,
  ),
  parse(
    "stagger",
    "Stagger",
    `
########DD####################DD########
D                                      D
#          ##########                  #
#                                      #
#                  ##########          #
#                                      #
#         1                  2         #
#                                      #
#          ##########                  #
#                                      #
#                  ##########          #
D                                      D
########DD####################DD########
`,
  ),
  parse(
    "hall",
    "Long Hall",
    `
########DD####################DD################
D                                              D
#                                              #
#      ####          ####          ####        #
#                                              #
#                    12                        #
#                                              #
#        ####          ####          ####      #
#                                              #
D                                              D
########DD####################DD################
`,
  ),
  parse(
    "chambers",
    "Chambers",
    `
########DD####################DD########
D               ##                     D
#               ##                     #
#               ##                     #
#       1                              #
#               ##                     #
##################                     #
#               ##                     #
#                      2               #
#               ##                     #
#               ##                     #
D               ##                     D
########DD####################DD########
`,
  ),
  parse(
    "fort",
    "Fort",
    `
########DD####################DD########
D                                      D
#                                      #
#     ####                    ####     #
#     ####                    ####     #
#                                      #
#              ##  12  ##              #
#                                      #
#     ####                    ####     #
#     ####                    ####     #
#                                      #
D                                      D
########DD####################DD########
`,
  ),
];

export function mapById(id: string): GameMap {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

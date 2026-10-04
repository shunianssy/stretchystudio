/**
 * splitLR.js
 *
 * Client-side Left/Right split for a single merged layer (e.g. "handwear" / "legwear").
 * Mirrors the server-side TBLR heuristic documented in docs/TBLR_implementation.md.
 *
 * 算法（两级，按可靠性从高到低）：
 *
 *  1) **连通域拆分**：对 alpha 蒙版做 8 连通标记（并查集）。
 *     若存在两个「体量相当」的连通域（第二大连通域 ≥ 主连通域的 25%），
 *     则按质心 X 分配左右：X 较小者为角色右侧（-r），较大者为角色左侧（-l）。
 *
 *  2) **列投影谷值切分（fallback）**：若只有一个主连通域（左右部件在上方相连，
 *     例如裤子在腰部连成一体、下方才有裆缝），则无法用连通域分开。
 *     此时在主体包围盒的中间带内寻找「列投影谷值」（不透明像素最少的列），
 *     在该列切一刀，把左右两侧像素分别取出。
 *     —— 这正是「只要有缝就分成两条腿」所依赖的逻辑。
 *
 *  若两级都失败，返回 `{ right: null, left: null }`，调用方应保留原始图层。
 */

/** Threshold below which a pixel is treated as transparent. */
const ALPHA_THRESHOLD = 10;

/**
 * 可能被合并成单层、需要左右拆分的对称部件基名。
 * （导入向导据此判断哪些图层需要提供「拆分左右」）
 */
export const SPLIT_CANDIDATES = [
  'handwear', 'legwear', 'footwear', 'objects',
  'irides', 'eyebrow', 'eyewhite', 'eyelash', 'ears',
];

/** 第二大连通域需达到主连通域该比例，才认为是「真正的两半」而非碎点噪声 */
export const SECOND_COMPONENT_MIN_RATIO = 0.25;
/** 谷值列的像素数需低于平均列高的该比例，才认为存在左右分界缝 */
export const VALLEY_MAX_RATIO = 0.5;
/** 每一侧像素占比下限，避免把主体切成一大一小 */
export const MIN_SIDE_RATIO = 0.2;

/* ── Union-Find ────────────────────────────────────────────────────────────── */

function makeUF(n) {
  const parent = new Int32Array(n);
  const rank   = new Uint8Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  return { parent, rank };
}

function find(uf, x) {
  while (uf.parent[x] !== x) {
    uf.parent[x] = uf.parent[uf.parent[x]]; // path compression (halving)
    x = uf.parent[x];
  }
  return x;
}

function unite(uf, a, b) {
  a = find(uf, a); b = find(uf, b);
  if (a === b) return;
  if (uf.rank[a] < uf.rank[b]) { const t = a; a = b; b = t; }
  uf.parent[b] = a;
  if (uf.rank[a] === uf.rank[b]) uf.rank[a]++;
}

/* ── 列投影谷值 ───────────────────────────────────────────────────────────── */

/**
 * 判断图层名是否带某一侧的显式后缀（如 `handwear-l` / `handwear_l` / `handwear left`）。
 *
 * 注意：**不能用 `matchTag` 来判断**——`matchTag` 会把后缀吃掉、只返回基名
 * （`matchTag('handwear-l') === 'handwear'`），所以拿它去比 `'handwear-l'` 永远为假。
 * 导入向导若用错，会把「已经拆开的图层」误判为「待拆分的合并层」并二次切分，
 * 结果就是把一只手套/一条腿从中间切断。
 *
 * @param {string} name     图层名
 * @param {string} baseTag  基名（如 'handwear'）
 * @param {'l'|'r'} side    哪一侧
 * @returns {boolean}
 */
export function hasSideSuffix(name, baseTag, side) {
  const word = side === 'l' ? '(l|left)' : '(r|right)';
  return new RegExp(`^${baseTag}[\\s_-]+${word}$`, 'i').test(String(name ?? '').trim());
}

/**
 * 在 `[x0, x1]` 的中间带内寻找列投影谷值（左右分界缝）。
 *
 * 纯函数，便于单元测试。
 *
 * @param {ArrayLike<number>} cols  每列的不透明像素数（索引为列号）
 * @param {number} x0  主体包围盒左边界（含）
 * @param {number} x1  主体包围盒右边界（含）
 * @returns {number} 切分列号；若不存在合适的缝则返回 -1
 */
export function findSplitColumn(cols, x0, x1) {
  const w = x1 - x0 + 1;
  if (w < 8) return -1; // 太窄，不值得切

  let total = 0;
  for (let x = x0; x <= x1; x++) total += cols[x];
  if (total <= 0) return -1;

  const mean = total / w;
  // 只在中间带搜索，避免把主体边缘（细长部分）当成谷值
  const pad = Math.max(1, Math.floor(w * 0.25));
  const lo = x0 + pad;
  const hi = x1 - pad;

  let bestX = -1;
  let best = Infinity;
  for (let x = lo; x <= hi; x++) {
    if (cols[x] < best) { best = cols[x]; bestX = x; }
  }
  if (bestX < 0) return -1;

  // 谷值必须足够「深」，否则说明没有缝（是一个实心整体）
  if (best > mean * VALLEY_MAX_RATIO) return -1;

  // 左右两侧体量必须相当，避免把主体切成一大一小
  let left = 0;
  for (let x = x0; x < bestX; x++) left += cols[x];
  const right = total - left - cols[bestX];
  const minSide = total * MIN_SIDE_RATIO;
  if (left < minSide || right < minSide) return -1;

  return bestX;
}

/* ── 提取 ──────────────────────────────────────────────────────────────────── */

/**
 * 按 `belongs(x, y)` 谓词把蒙版内像素裁剪到最小包围盒并返回 PsdLayer 片段。
 *
 * @returns {{imageData: ImageData, x: number, y: number, width: number, height: number}|null}
 */
function extractByMask(data, W, H, offX, offY, belongs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!belongs(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return null;

  const cW = maxX - minX + 1;
  const cH = maxY - minY + 1;
  const out = new ImageData(cW, cH);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!belongs(x, y)) continue;
      const src = (y * W + x) * 4;
      const dst = ((y - minY) * cW + (x - minX)) * 4;
      out.data[dst]     = data[src];
      out.data[dst + 1] = data[src + 1];
      out.data[dst + 2] = data[src + 2];
      out.data[dst + 3] = data[src + 3];
    }
  }
  return { imageData: out, x: offX + minX, y: offY + minY, width: cW, height: cH };
}

/* ── Main split function ───────────────────────────────────────────────────── */

/**
 * Split a merged layer into left and right components.
 *
 * @param {object} layer   A PsdLayer object (has .imageData, .x, .y, .width, .height, .name, …)
 * @returns {{ right: object|null, left: object|null, componentCount: number, method: string }}
 *   right = 角色右侧（图像中质心 X 较小的一侧）
 *   left  = 角色左侧（图像中质心 X 较大的一侧）
 *   method = 'component' | 'valley' | 'none'
 */
export function splitLayerLR(layer) {
  const { imageData, width: W, height: H, x: offX, y: offY } = layer;
  const data = imageData.data;
  const N = W * H;

  /* 1. 不透明像素蒙版 */
  const opaque = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    opaque[i] = data[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;
  }

  /* 2. 并查集 8 连通标记 */
  const uf = makeUF(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!opaque[idx]) continue;
      if (x > 0 && opaque[idx - 1]) unite(uf, idx, idx - 1);
      if (y > 0) {
        if (opaque[idx - W])                       unite(uf, idx, idx - W);
        if (x > 0     && opaque[idx - W - 1])      unite(uf, idx, idx - W - 1);
        if (x < W - 1 && opaque[idx - W + 1])      unite(uf, idx, idx - W + 1);
      }
    }
  }

  /* 3. 统计每个连通域的像素数（质心与包围盒推迟到需要时才算） */
  const pixCount = new Map();
  for (let i = 0; i < N; i++) {
    if (!opaque[i]) continue;
    const root = find(uf, i);
    pixCount.set(root, (pixCount.get(root) ?? 0) + 1);
  }

  const componentCount = pixCount.size;

  if (componentCount === 0) {
    return { right: null, left: null, componentCount, method: 'none' };
  }

  const sorted = Array.from(pixCount.entries()).sort((a, b) => b[1] - a[1]);
  const [mainRoot, mainCount] = sorted[0];

  /* 4. 途径一：存在「体量相当」的第二大连通域 → 直接按连通域左右分配 */
  if (sorted.length >= 2 && sorted[1][1] >= mainCount * SECOND_COMPONENT_MIN_RATIO) {
    const [root1, cnt1] = sorted[0];
    const [root2, cnt2] = sorted[1];

    // 质心 X（图像坐标）——只需 X 即可判定左右
    let sumX1 = 0, sumX2 = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!opaque[idx]) continue;
        const r = find(uf, idx);
        if (r === root1) sumX1 += x;
        else if (r === root2) sumX2 += x;
      }
    }
    const cx1 = sumX1 / cnt1;
    const cx2 = sumX2 / cnt2;

    // 角色视角：质心 X 较小者为角色右侧
    const rootRight = cx1 < cx2 ? root1 : root2;
    const rootLeft  = cx1 < cx2 ? root2 : root1;

    const rightExtract = extractByMask(data, W, H, offX, offY,
      (x, y) => opaque[y * W + x] === 1 && find(uf, y * W + x) === rootRight);
    const leftExtract = extractByMask(data, W, H, offX, offY,
      (x, y) => opaque[y * W + x] === 1 && find(uf, y * W + x) === rootLeft);

    return { right: rightExtract, left: leftExtract, componentCount, method: 'component' };
  }

  /* 5. 途径二：只有一个主连通域（左右部件在上方相连）→ 找列投影谷值切一刀 */
  {
    let bMinX = Infinity, bMaxX = -Infinity;
    const cols = new Int32Array(W);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!opaque[idx]) continue;
        if (find(uf, idx) !== mainRoot) continue; // 只统计主连通域，避免碎点干扰
        cols[x]++;
        if (x < bMinX) bMinX = x;
        if (x > bMaxX) bMaxX = x;
      }
    }

    if (bMinX !== Infinity) {
      const xCut = findSplitColumn(cols, bMinX, bMaxX);
      if (xCut >= 0) {
        // 按整张蒙版（含碎点）在 xCut 处切开，碎点跟随其所在的一侧
        const rightExtract = extractByMask(data, W, H, offX, offY,
          (x, y) => opaque[y * W + x] === 1 && x < xCut);
        const leftExtract = extractByMask(data, W, H, offX, offY,
          (x, y) => opaque[y * W + x] === 1 && x >= xCut);
        return { right: rightExtract, left: leftExtract, componentCount, method: 'valley' };
      }
    }
  }

  return { right: null, left: null, componentCount, method: 'none' };
}

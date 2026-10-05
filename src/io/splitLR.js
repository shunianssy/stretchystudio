/**
 * splitLR.js - 单个「左右合并层」的客户端拆分（如 handwear / legwear）
 *
 * 大白话说明：
 *   有些部件在 PSD 里是画成一张图的（比如两只手套画在同一层），
 *   这个文件负责把它按「左边一半 / 右边一半」切开，拆成 -l / -r 两个图层。
 *   算法与 docs/TBLR_implementation.md 里记录的服务端启发式保持一致。
 *
 * 对外可调用的方法：
 *   hasSideSuffix(图层名, 基名, 'l'|'r')   判断图层名是否已经带某一侧的显式后缀
 *   findSplitColumn(每列像素数, 左界, 右界) 在中间带里找「左/右分界缝」（列投影谷值）
 *   splitLayerLR(图层对象)                 主入口：把合并层拆成左右两块
 *
 * 典型调用方式：
 *   const { right, left, method } = splitLayerLR(layer);
 *   // method = 'component' | 'valley' | 'none'；none 时调用方保留原始图层
 *
 * 两条拆分途径（按可靠性从高到低）：
 *
 *   1) 连通域拆分：对 alpha 蒙版做 8 连通标记（并查集）。
 *      若存在两个「体量相当」的连通域（第二大连通域 ≥ 主连通域的 25%），
 *      就按质心 X 分配左右：X 较小者为角色右侧（-r），较大者为角色左侧（-l）。
 *
 *   2) 列投影谷值切分（fallback）：若只有一个主连通域（左右部件在上方相连，
 *      例如裤子在腰部连成一体、只有下方才有裆缝），连通域分不开。
 *      此时在主体包围盒的中间带内找「列投影谷值」（不透明像素最少的列），
 *      在该列切一刀，把左右两侧像素分别取出。
 *      —— 「只要有缝就分成两条腿」靠的就是这条。
 *
 *   若两条途径都失败，返回 { right: null, left: null }，调用方应保留原始图层。
 */

/** 透明度低于该值就当作透明像素（抗锯齿边缘的噪声过滤） */
const ALPHA_THRESHOLD = 10;

/**
 * 可能是「合并成单层、需要左右拆分」的对称部件基名。
 * 导入向导据此判断哪些图层需要提供「拆分左右」的选项。
 */
export const SPLIT_CANDIDATES = [
  'handwear', 'legwear', 'footwear', 'objects',
  'irides', 'eyebrow', 'eyewhite', 'eyelash', 'ears',
];

/** 第二大连通域要达到主连通域的这个比例，才算「真正的两半」而不是碎点噪声 */
export const SECOND_COMPONENT_MIN_RATIO = 0.25;

/** 谷值列的像素数要低于平均列高的这个比例，才认为左右之间真的存在分界缝 */
export const VALLEY_MAX_RATIO = 0.5;

/** 每一侧像素占比的下限，避免把主体切成一大一小（那不是对称部件） */
export const MIN_SIDE_RATIO = 0.2;


/* ── 并查集（Union-Find），用于 8 连通标记 ────────────────────────────────── */

/** 创建 n 个元素的并查集，每个元素初始自成一个集合 */
function makeUF(n) {
  const parent = new Int32Array(n);
  const rank = new Uint8Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  return { parent, rank };
}

/** 查根节点，带路径压缩（折半压缩，无需递归、栈安全） */
function find(uf, x) {
  while (uf.parent[x] !== x) {
    uf.parent[x] = uf.parent[uf.parent[x]]; // 路径压缩：把当前节点直接指向祖父
    x = uf.parent[x];
  }
  return x;
}

/** 合并两个集合，按 rank 做小树挂大树，避免退化成链表 */
function unite(uf, a, b) {
  a = find(uf, a);
  b = find(uf, b);

  // 已经在同一个集合，无需合并
  if (a === b) return;

  // 让小 rank 的根挂到大 rank 的根下面
  if (uf.rank[a] < uf.rank[b]) {
    const temp = a;
    a = b;
    b = temp;
  }
  uf.parent[b] = a;

  // 两棵树一样高时合并后高度 +1
  if (uf.rank[a] === uf.rank[b]) uf.rank[a]++;
}


/* ── 列投影谷值 ──────────────────────────────────────────────────────────── */

/**
 * 判断图层名是否带某一侧的显式后缀（如 handwear-l / handwear_l / handwear left）。
 *
 * 注意：**不能用 matchTag 来判断**——matchTag 会把后缀吃掉、只返回基名
 * （matchTag('handwear-l') === 'handwear'），拿它去比 'handwear-l' 永远为假。
 * 导入向导若用错，会把「已经拆开的图层」误判为「待拆分的合并层」并二次切分，
 * 结果就是把一只手套 / 一条腿从中间切断。
 *
 * @param {string} name     图层名
 * @param {string} baseTag  基名（如 'handwear'）
 * @param {'l'|'r'} side    哪一侧
 * @returns {boolean} true 表示图层名显式标明了该侧
 */
export function hasSideSuffix(name, baseTag, side) {
  // l 侧同时接受 l 与 left 两种写法，r 侧同理
  const sideWord = side === 'l' ? '(l|left)' : '(r|right)';
  return new RegExp(`^${baseTag}[\\s_-]+${sideWord}$`, 'i').test(String(name ?? '').trim());
}

/**
 * 在 [x0, x1] 的中间带内寻找列投影谷值（左右分界缝）。
 * 纯函数，方便单元测试。
 *
 * @param {ArrayLike<number>} cols 每列的不透明像素数（下标即列号）
 * @param {number} x0 主体包围盒左边界（含）
 * @param {number} x1 主体包围盒右边界（含）
 * @returns {number} 切分列号；没有合适的缝时返回 -1
 */
export function findSplitColumn(cols, x0, x1) {
  const width = x1 - x0 + 1;

  // 卫语句：太窄，切了也没意义
  if (width < 8) return -1;

  // 段落 1：统计总像素与平均列高
  let total = 0;
  for (let x = x0; x <= x1; x++) total += cols[x];

  // 卫语句：整段没有不透明像素，谈不上分缝
  if (total <= 0) return -1;

  const mean = total / width;

  // 段落 2：只在中间带搜索谷值
  // 两侧各留 25% 的边距，避免把主体边缘（细长部分）误当成谷值
  const pad = Math.max(1, Math.floor(width * 0.25));
  const searchLeft = x0 + pad;
  const searchRight = x1 - pad;

  let splitColumn = -1;
  let minColumnHeight = Infinity;
  for (let x = searchLeft; x <= searchRight; x++) {
    if (cols[x] < minColumnHeight) {
      minColumnHeight = cols[x];
      splitColumn = x;
    }
  }
  if (splitColumn < 0) return -1;

  // 段落 3：谷值必须足够「深」，否则说明是实心整体、没有缝
  if (minColumnHeight > mean * VALLEY_MAX_RATIO) return -1;

  // 段落 4：左右两侧体量必须相当，避免把主体切成一大一小
  let leftPixels = 0;
  for (let x = x0; x < splitColumn; x++) leftPixels += cols[x];
  const rightPixels = total - leftPixels - cols[splitColumn];
  const minSidePixels = total * MIN_SIDE_RATIO;
  if (leftPixels < minSidePixels || rightPixels < minSidePixels) return -1;

  return splitColumn;
}


/* ── 像素提取 ────────────────────────────────────────────────────────────── */

/**
 * 按 belongs(x, y) 谓词把蒙版内的像素裁剪到最小包围盒，返回一个 PsdLayer 片段。
 *
 * @param {Uint8ClampedArray} data RGBA 像素数据（整张图）
 * @param {number} imageWidth  整张图宽
 * @param {number} imageHeight 整张图高
 * @param {number} offsetX 图层在 PSD 画布上的偏移 X（用于还原绝对坐标）
 * @param {number} offsetY 图层在 PSD 画布上的偏移 Y
 * @param {(x:number, y:number)=>boolean} belongs 该像素是否属于要提取的区域
 * @returns {{imageData: ImageData, x: number, y: number, width: number, height: number}|null}
 */
function extractByMask(data, imageWidth, imageHeight, offsetX, offsetY, belongs) {
  // 段落 1：扫描出属于区域的像素的最小包围盒
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      if (!belongs(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // 卫语句：没有任何像素属于该区域
  if (minX === Infinity) return null;

  // 段落 2：把区域内的像素拷进新画布
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const out = new ImageData(cropWidth, cropHeight);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!belongs(x, y)) continue;

      const src = (y * imageWidth + x) * 4;
      const dst = ((y - minY) * cropWidth + (x - minX)) * 4;

      // 整段 RGBA 一起搬，避免逐通道赋值带来的开销
      out.data[dst] = data[src];
      out.data[dst + 1] = data[src + 1];
      out.data[dst + 2] = data[src + 2];
      out.data[dst + 3] = data[src + 3];
    }
  }

  // x/y 要加回图层偏移，才能还原成 PSD 画布上的绝对坐标
  return { imageData: out, x: offsetX + minX, y: offsetY + minY, width: cropWidth, height: cropHeight };
}


/* ── 主拆分函数 ──────────────────────────────────────────────────────────── */

/**
 * 把一个「左右合并层」拆成左右两块。
 *
 * @param {object} layer PsdLayer 对象（含 .imageData / .x / .y / .width / .height / .name …）
 * @returns {{ right: object|null, left: object|null, componentCount: number, method: string }}
 *   right  = 角色右侧（图像中质心 X 较小的一侧）
 *   left   = 角色左侧（图像中质心 X 较大的一侧）
 *   method = 'component'（连通域）| 'valley'（谷值切分）| 'none'（失败）
 */
export function splitLayerLR(layer) {
  const { imageData, width: imageWidth, height: imageHeight, x: offsetX, y: offsetY } = layer;
  const data = imageData.data;
  const pixelCount = imageWidth * imageHeight;

  // 段落 1：生成不透明像素蒙版（1 = 不透明，0 = 透明）
  const opaque = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    opaque[i] = data[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;
  }

  // 段落 2：并查集做 8 连通标记（上、左、左上、右上已访问，其余方向会在后续行补上）
  const unionFind = makeUF(pixelCount);
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const index = y * imageWidth + x;
      if (!opaque[index]) continue;

      if (x > 0 && opaque[index - 1]) unite(unionFind, index, index - 1);
      if (y > 0) {
        if (opaque[index - imageWidth]) unite(unionFind, index, index - imageWidth);
        if (x > 0 && opaque[index - imageWidth - 1]) unite(unionFind, index, index - imageWidth - 1);
        if (x < imageWidth - 1 && opaque[index - imageWidth + 1]) unite(unionFind, index, index - imageWidth + 1);
      }
    }
  }

  // 段落 3：统计每个连通域的像素数
  // （质心与包围盒都推迟到真正需要时再算，避免无谓的一整轮遍历）
  const pixelsPerRoot = new Map();
  for (let i = 0; i < pixelCount; i++) {
    if (!opaque[i]) continue;
    const root = find(unionFind, i);
    pixelsPerRoot.set(root, (pixelsPerRoot.get(root) ?? 0) + 1);
  }

  const componentCount = pixelsPerRoot.size;

  // 卫语句：整层没有任何不透明像素
  if (componentCount === 0) {
    return { right: null, left: null, componentCount, method: 'none' };
  }

  // 按像素数从大到小排序，sorted[0] 即主连通域
  const sortedComponents = Array.from(pixelsPerRoot.entries()).sort((a, b) => b[1] - a[1]);
  const mainRoot = sortedComponents[0][0];
  const mainCount = sortedComponents[0][1];

  // 段落 4：途径一 —— 存在「体量相当」的第二大连通域，直接按连通域左右分配
  if (sortedComponents.length >= 2 && sortedComponents[1][1] >= mainCount * SECOND_COMPONENT_MIN_RATIO) {
    const [root1, count1] = sortedComponents[0];
    const [root2, count2] = sortedComponents[1];

    // 求两个连通域的质心 X（判定左右只需 X，不用算 Y）
    let sumX1 = 0;
    let sumX2 = 0;
    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const index = y * imageWidth + x;
        if (!opaque[index]) continue;

        const root = find(unionFind, index);
        if (root === root1) sumX1 += x;
        else if (root === root2) sumX2 += x;
      }
    }
    const centerX1 = sumX1 / count1;
    const centerX2 = sumX2 / count2;

    // 角色视角：质心 X 较小者是角色右侧（符合 Live2D / Spine 的左右惯例）
    const rootRight = centerX1 < centerX2 ? root1 : root2;
    const rootLeft = centerX1 < centerX2 ? root2 : root1;

    // 分别提取左右两侧的像素
    const rightExtract = extractByMask(data, imageWidth, imageHeight, offsetX, offsetY,
      (x, y) => opaque[y * imageWidth + x] === 1 && find(unionFind, y * imageWidth + x) === rootRight);
    const leftExtract = extractByMask(data, imageWidth, imageHeight, offsetX, offsetY,
      (x, y) => opaque[y * imageWidth + x] === 1 && find(unionFind, y * imageWidth + x) === rootLeft);

    return { right: rightExtract, left: leftExtract, componentCount, method: 'component' };
  }

  // 段落 5：途径二 —— 只有一个主连通域（左右在上方相连），找列投影谷值切一刀
  {
    let boundsMinX = Infinity;
    let boundsMaxX = -Infinity;
    const columns = new Int32Array(imageWidth);

    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const index = y * imageWidth + x;
        if (!opaque[index]) continue;
        // 只统计主连通域，避免右侧碎点把列高抬高、掩盖真正的缝
        if (find(unionFind, index) !== mainRoot) continue;

        columns[x]++;
        if (x < boundsMinX) boundsMinX = x;
        if (x > boundsMaxX) boundsMaxX = x;
      }
    }

    // 主连通域非空时才尝试找缝
    if (boundsMinX !== Infinity) {
      const splitX = findSplitColumn(columns, boundsMinX, boundsMaxX);

      if (splitX >= 0) {
        // 按整张蒙版（含碎点）在 splitX 处切开：碎点跟随它所在的那一侧
        const rightExtract = extractByMask(data, imageWidth, imageHeight, offsetX, offsetY,
          (x, y) => opaque[y * imageWidth + x] === 1 && x < splitX);
        const leftExtract = extractByMask(data, imageWidth, imageHeight, offsetX, offsetY,
          (x, y) => opaque[y * imageWidth + x] === 1 && x >= splitX);
        return { right: rightExtract, left: leftExtract, componentCount, method: 'valley' };
      }
    }
  }

  // 两条途径都失败：调用方应保留原始图层
  return { right: null, left: null, componentCount, method: 'none' };
}

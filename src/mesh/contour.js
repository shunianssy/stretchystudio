/**
 * 轮廓提取与平滑——纯算法模块，不依赖 DOM、不使用全局变量。
 *
 * 职责：从二进制 alpha 蒙版出发，膨胀蒙版、追踪所有闭合边界，再对轮廓做等距重采样与平滑，
 * 供 generate.js 组装成网格的边界点。
 *
 * 对外提供：
 *   dilateAlphaMask(data, width, height, threshold, radius) → 膨胀后的二值蒙版
 *   traceAllContours(mask, width, height)                   → 闭合轮廓点列表的数组
 *   resampleContour(contour, numPoints)                     → 等距重采样后的轮廓
 *   smoothContour(points, numPasses)                        → 平滑后的轮廓
 * 典型调用：
 *   const mask = dilateAlphaMask(rgba, w, h, 5, 2);
 *   const contours = traceAllContours(mask, w, h);
 *   const smooth = smoothContour(resampleContour(contours[0], 40), 2);
 *
 * 坐标空间：轮廓点 [x, y] 均为像素坐标，处于整张 PSD 画布坐标系。
 */

// ─── 段落：alpha 蒙版构建与膨胀 ───────────────────────────────────────────────

/**
 * 构建二值 alpha 蒙版，并将其按 `radius` 像素向外膨胀（L∞ 距离 / 可分离两趟实现）。
 *
 * 为什么要膨胀：让边界顶点落到可视轮廓之外。渲染时纹理 alpha 会裁掉溢出部分，
 * 于是「网格直线边切进曲线内部」的弦切缺口被遮住——网格始终覆盖住完整图像内容。
 *
 * @param {Uint8ClampedArray} data      - 原始 RGBA 像素数据
 * @param {number}            width     - 画布宽（px）
 * @param {number}            height    - 画布高（px）
 * @param {number}            threshold - 判定「内部」的 alpha 阈值
 * @param {number}            radius    - 膨胀半径（px，0 表示不膨胀）
 * @returns {Uint8Array}                膨胀后的二值蒙版（1 = 内部）
 */
export function dilateAlphaMask(data, width, height, threshold, radius) {
  // 先按 alpha 通道建立初版二值蒙版。
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    mask[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
  }

  // 卫语句：半径为 0 无需膨胀，直接返回初版蒙版。
  if (radius <= 0) return mask;

  // 第一趟：水平方向取邻域最大值（向左右膨胀）。
  // 可分离实现＝先横后纵两趟，等价于一个方形结构元的膨胀，比直接二维卷积更快。
  const tmp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let isFound = false;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let nx = x0; nx <= x1 && !isFound; nx++) {
        if (mask[y * width + nx]) isFound = true;
      }
      tmp[y * width + x] = isFound ? 1 : 0;
    }
  }

  // 第二趟：垂直方向取邻域最大值（向上下膨胀），作用于第一趟的结果。
  const dilated = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let isFound = false;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      for (let ny = y0; ny <= y1 && !isFound; ny++) {
        if (tmp[ny * width + x]) isFound = true;
      }
      dilated[y * width + x] = isFound ? 1 : 0;
    }
  }

  return dilated;
}

// ─── 段落：多区域轮廓追踪 ─────────────────────────────────────────────────────

// 8 邻域方向向量，按「顺时针」排列：右、右下、下、左下、左、左上、上、右上。
// 追踪时按固定顺序扫描，保证同一张蒙版每次得到一致的轮廓走向。
const DIRS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

/**
 * 从 (startX, startY) 出发追踪一条闭合边界。
 * 沿途把走过的边界像素在 `visited` 中标记，避免其它区域重复追踪。
 *
 * 算法：Moore 邻域边界追踪——每到一个像素，以「上一步的来向」为基准，
 * 顺时针扫描 8 邻域找到下一个边界像素，如此循环直至回到起点。
 *
 * @param {Uint8Array} mask    - 二值蒙版
 * @param {number}     width   - 画布宽（px）
 * @param {number}     height  - 画布高（px）
 * @param {number}     startX  - 起始像素 x
 * @param {number}     startY  - 起始像素 y
 * @param {Uint8Array} visited - 共享的已访问数组，函数内就地修改
 * @returns {Array<[number,number]>} 闭合轮廓点列表（不重复包含起点）
 */
function traceSingleContour(mask, width, height, startX, startY, visited) {
  const contour = [[startX, startY]];
  visited[startY * width + startX] = 1;

  let currentX = startX, currentY = startY;
  // 初始来向设为 6（左），与历史实现保持一致，用于确定首个搜索基准。
  let previousDirection = 6;

  // 搜索起点 = 「来向」相对偏移 6（即反向 4 步 + 再转 2 步）：先尽量沿着来向的边缘继续走，
  // 避免原路折返，再顺时针扫一圈，保证紧贴边界连续前进。
  // 安全上限：最多走 2 倍的像素总数；若蒙版异常导致无法闭合，也不会死循环。
  const maxSteps = width * height * 2;
  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    let isFound = false;
    for (let i = 0; i < 8; i++) {
      const dir = (previousDirection + 6 + i) % 8;
      const [dx, dy] = DIRS[dir];
      const nx = currentX + dx, ny = currentY + dy;
      // 越界的邻居跳过。
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (mask[ny * width + nx]) {
        previousDirection = dir;
        currentX = nx;
        currentY = ny;
        isFound = true;
        break;
      }
    }
    // 8 邻域都找不到下一个边界像素（孤立点等退化情况），结束。
    if (!isFound) break;
    // 回到起点＝轮廓闭合，结束。
    if (currentX === startX && currentY === startY) break;
    visited[currentY * width + currentX] = 1;
    contour.push([currentX, currentY]);
  }

  return contour;
}

/**
 * 追踪二值蒙版中所有闭合轮廓。
 * 每个连通的不透明区域返回一条轮廓。
 *
 * @param {Uint8Array} mask   - 二值蒙版
 * @param {number}     width  - 画布宽（px）
 * @param {number}     height - 画布高（px）
 * @returns {Array<Array<[number,number]>>} 轮廓点列表的数组
 */
export function traceAllContours(mask, width, height) {
  const visited = new Uint8Array(width * height);
  const contours = [];

  // 从 1 开始、到 width/height - 1 结束：判定需要访问左邻居 idx-1，边界留 1 像素避免越界。
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // 起点条件：本身在区域内、左邻居在区域外（即该区域最左侧的像素）、且尚未被追踪。
      // 这样每个连通区域只会由其最左侧像素触发一次追踪。
      if (mask[idx] && !mask[idx - 1] && !visited[idx]) {
        const contour = traceSingleContour(mask, width, height, x, y, visited);
        // 少于 3 个点无法成面，丢弃退化轮廓。
        if (contour.length >= 3) contours.push(contour);
      }
    }
  }

  return contours;
}

// ─── 段落：按弧长等距重采样 ───────────────────────────────────────────────────

/**
 * 对闭合轮廓重采样，使采样点在周长上均匀分布。
 *
 * @param {Array<[number,number]>} contour   - 输入轮廓点
 * @param {number}                 numPoints - 目标采样点数
 * @returns {Array<[number,number]>}
 */
export function resampleContour(contour, numPoints) {
  // 卫语句：点数不足 2 无法定义弧长，原样返回。
  if (contour.length < 2) return contour;

  // 累计弧长：arcLengths[i] 表示从起点沿轮廓走到第 i 个点的总长度。
  const arcLengths = [0];
  for (let i = 1; i < contour.length; i++) {
    const dx = contour[i][0] - contour[i - 1][0];
    const dy = contour[i][1] - contour[i - 1][1];
    arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }

  // 闭合轮廓：还需补上「末点回到起点」的最后一段。
  const lastIndex = contour.length - 1;
  const dx0 = contour[0][0] - contour[lastIndex][0];
  const dy0 = contour[0][1] - contour[lastIndex][1];
  const totalLength = arcLengths[lastIndex] + Math.sqrt(dx0 * dx0 + dy0 * dy0);

  // 均分周长得到步长，再在每个目标长度处线性插值出采样点。
  const result = [];
  const step = totalLength / numPoints;
  let segmentIndex = 0;

  for (let i = 0; i < numPoints; i++) {
    const targetLen = i * step;
    // 推进到 targetLen 所在的弧段。
    while (segmentIndex < arcLengths.length - 1 && arcLengths[segmentIndex + 1] < targetLen) segmentIndex++;

    // 该段内的插值比例 t∈[0,1]；已到末尾段时取 0（回落到端点）。
    const t = (segmentIndex < arcLengths.length - 1)
      ? Math.min(1, (targetLen - arcLengths[segmentIndex]) / (arcLengths[segmentIndex + 1] - arcLengths[segmentIndex]))
      : 0;

    const p0 = contour[segmentIndex];
    const p1 = contour[(segmentIndex + 1) % contour.length];
    result.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
  }

  return result;
}

// ─── 段落：拉普拉斯平滑 ───────────────────────────────────────────────────────

/**
 * 用拉普拉斯（邻居平均）松弛对轮廓做平滑。
 *
 * 权重 (前一点 + 2×当前点 + 后一点) / 4 为二项式权重：当前点权重更大，
 * 在磨掉锯齿的同时，不会让整体轮廓过度收缩。
 *
 * @param {Array<[number,number]>} points    - 轮廓点
 * @param {number}                 numPasses - 平滑次数
 * @returns {Array<[number,number]>}
 */
export function smoothContour(points, numPasses = 0) {
  let result = points.slice();
  for (let p = 0; p < numPasses; p++) {
    // 每轮都基于上一轮的整体结果重算，避免同轮内互相影响。
    result = result.map((pt, i) => {
      const prev = result[(i - 1 + result.length) % result.length];
      const next = result[(i + 1) % result.length];
      return [(prev[0] + pt[0] * 2 + next[0]) / 4, (prev[1] + pt[1] * 2 + next[1]) / 4];
    });
  }
  return result;
}

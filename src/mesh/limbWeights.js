/**
 * limbWeights.js - 四肢（手臂 / 腿）网格的关节形变权重
 *
 * 这个文件只干一件事：
 *   算出四肢网格上每个顶点该「多跟一点肩 / 髋」还是「多跟一点肘 / 膝」，
 *   这样关节弯曲时部件是平滑过渡的，而不是整块硬邦邦地旋转。
 *
 * 权重的含义（与关节旋转联用）：
 *   0 = 完全跟随父关节（肩 / 髋），不随肘 / 膝转动；
 *   1 = 完全跟随子关节（肘 / 膝），刚性绕关节轴心旋转。
 *
 * 对外可调用的方法：
 *   isDegenerateJoint(...)      判断关节轴心是否退化（与父关节几乎重合）
 *   suggestLimbJointPivot(...)  为退化关节推导一个合理的轴心（自愈修复用）
 *   computeLimbWeights(...)     计算权重数组（本模块主入口）
 *
 * 典型调用方式：
 *   const weights = computeLimbWeights(vertices, shoulderX, shoulderY, elbowX, elbowY, 40, triangles);
 *
 * ── 三条必须遵守的铁律（都是踩过坑换来的） ─────────────────────────────
 *
 *   1) 必须用静止坐标（restX/restY）算，不能用当前坐标（x/y）。
 *      关节轴心与顶点都存放在同一套「静止坐标系」里；而 x/y 会被关节旋转
 *      烘焙成已形变的坐标。若用当前坐标重新估算「谁在关节外侧」，每次拖动
 *      都会把混合带切到另一批顶点上 —— 反复拖动后部件会被逐渐剪切（表现为
 *      「扭曲」「被拉长」）。restX/restY 自网格生成后不再变化，权重因此稳定。
 *
 *   2) 必须每次用当前轴心重算，不能把权重烘焙进 mesh。
 *      关节轴心在绑定阶段会被拖动；烘焙过的权重会过期，导致关节两侧顶点按
 *      错误比例旋转，表现为部件扭曲、出现硬折痕（看起来像被切开）。
 *
 *   3) 沿「网格拓扑」量距离，不要沿直线投影量距离。
 *      直线投影（把顶点投到「肩→肘」轴线上）在两种情况下会算错权重，两种都会
 *      让部件被撕裂/揉皱（用户报的「手部扭曲」就是它）：
 *        a. 贴图里肢体本身是弯的（L 形 / 抬起的胳膊）：肢体远端在几何上「绕回」
 *           了关节后方，直线投影把它算成「还在肩这一侧」，于是远端拿到权重 0
 *           原地不动、而它的邻居拿到 1 飞走 —— 部件被扯成扇形；
 *        b. 部件很小且关节轴心落在部件内部（例如手腕被拖到了手套中间）：
 *           整只手套横跨混合带，一半 1 一半 0，旋转后手套被对折。
 *      改用「网格上的测地距离」（从靠近父关节的顶点出发，沿三角形边做最短路）
 *      后，距离天然沿肢体走向增长，上面两种情况都能得到正确的一侧归属。
 *
 * ── 混合带形状：只在「关节近端」做过渡 ───────────────────────────────
 *   旧公式是「关节两侧各 ±blend/2 过渡」：关节处 0.5，关节远端才是 1。
 *   但关节远端常常是手掌这种「一整块刚性部件」，让它的一部分拿 0.5、一部分拿 1，
 *   结果就是手腕一转、手掌被拧成麻花。
 *   现在的公式只在关节近端（靠近肩的一侧）做过渡：
 *       权重 = clamp(1 - (关节处距离 - 顶点距离) / blend, 0, 1)
 *   即「越过关节的顶点一律 1（刚性跟随）」，「关节以前 blend 像素内线性过渡」。
 *   这样无论轴心落在哪里，位于关节远端的部件都不会被自身关节撕裂。
 *
 * 另外，当「肩 → 肘」轴长过短（关节几乎压在父关节上，通常是自动绑定给错了
 * 位置）时，轴向是没有意义的方向，此时任何权重都是噪声。这种情况一律返回
 * 全 0（部件不参与形变），由调用方提示用户先调整关节位置。
 */

/** 轴长小于该值就视为「关节与父关节重合」—— 此时无法定义肢体轴向 */
export const MIN_JOINT_AXIS = 8;

/** 默认过渡带宽度（像素）：从关节处往父关节方向（近端）延伸这么长做过渡 */
export const DEFAULT_BLEND = 40;


/**
 * 把数值夹到 [0, 1]。
 *
 * @param {number} value 待夹取的值
 * @returns {number} 夹取后的结果
 */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}


/**
 * 判断关节轴心是否退化（与父关节几乎重合）。
 *
 * 为什么需要它：退化的轴心意味着「肢体朝哪个方向」都算不出来，
 * 任何权重都是噪声。调用方据此决定是否提示用户先调整关节位置。
 *
 * @param {number} shoulderX 父关节（肩 / 髋）轴心 X
 * @param {number} shoulderY 父关节轴心 Y
 * @param {number} jointX    子关节（肘 / 膝）轴心 X
 * @param {number} jointY    子关节轴心 Y
 * @returns {boolean} true 表示轴心位置无意义，形变应当跳过
 */
export function isDegenerateJoint(shoulderX, shoulderY, jointX, jointY) {
  // 先算父关节到子关节的位移，轴长够长才算「有方向」
  const dx = Number(jointX) - Number(shoulderX);
  const dy = Number(jointY) - Number(shoulderY);

  // 坐标不是数字、或轴长不足阈值，都算退化
  return !Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < MIN_JOINT_AXIS;
}


/**
 * 取顶点用于权重计算的坐标：优先静止坐标，回退到当前坐标。
 *
 * 为什么要有兜底：restX/restY 缺失说明该顶点是旧数据或新加的，
 * 这时只能用 x/y 顶上，避免整条权重算不出来。
 *
 * @param {{x?:number,y?:number,restX?:number,restY?:number}} v 顶点
 * @returns {[number, number]} 可用于计算的 [x, y]
 */
function restCoord(v) {
  const restX = v?.restX;
  const restY = v?.restY;

  // 静止坐标齐全时优先使用（权重才不会随形变漂移）
  if (Number.isFinite(restX) && Number.isFinite(restY)) return [restX, restY];

  // 兜底：旧数据没有静止坐标，退而求其次用当前坐标
  return [v?.x ?? 0, v?.y ?? 0];
}


/* ══════════════════════════════════════════════════════════════════════════
 * 网格拓扑工具：测地距离（沿三角形边的最短路）
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 由三角形索引构建顶点邻接表，边长取「静止坐标」下的欧氏距离。
 *
 * 用静止坐标是铁律 1 的直接落地：若用形变后的 x/y 量边长，拖动一次图就会变，
 * 权重随之漂移。
 *
 * @param {Array<object>} vertices  顶点数组
 * @param {Array<Array<number>>} triangles 三角形顶点下标三元组
 * @returns {Array<Array<[number, number]>>} 邻接表：adjacency[i] = [[邻点下标, 边长], ...]
 */
function buildRestAdjacency(vertices, triangles) {
  const vertexCount = vertices.length;
  const adjacency = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) adjacency[i] = [];

  for (const triangle of triangles ?? []) {
    if (!triangle || triangle.length < 3) continue;
    for (let corner = 0; corner < 3; corner++) {
      const a = triangle[corner];
      const b = triangle[(corner + 1) % 3];
      // 跳过非法下标与自环，避免脏数据把邻接表写坏
      if (a === b) continue;
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      if (a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) continue;

      const [ax, ay] = restCoord(vertices[a]);
      const [bx, by] = restCoord(vertices[b]);
      const length = Math.hypot(ax - bx, ay - by);
      adjacency[a].push([b, length]);
      adjacency[b].push([a, length]);
    }
  }
  return adjacency;
}


/**
 * 极简二叉最小堆（Dijkstra 用）。
 *
 * 为什么不直接用数组每次扫最小：网格顶点可达数百个，O(V²) 也还行，
 * 但堆版本更稳，且实现只有几十行，不值得为此引入依赖。
 *
 * @returns {{size:number, push:Function, pop:Function}} 堆接口
 */
function createMinHeap() {
  const items = []; // 每项为 [距离, 顶点下标]

  return {
    get size() {
      return items.length;
    },

    /** 入堆并上浮 */
    push(distance, index) {
      items.push([distance, index]);
      let child = items.length - 1;
      while (child > 0) {
        const parent = (child - 1) >> 1;
        if (items[parent][0] <= items[child][0]) break;
        const swap = items[parent];
        items[parent] = items[child];
        items[child] = swap;
        child = parent;
      }
    },

    /** 弹出最小值并下沉 */
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length > 0) {
        items[0] = last;
        let parent = 0;
        for (;;) {
          const left = parent * 2 + 1;
          const right = left + 1;
          let smallest = parent;
          if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
          if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
          if (smallest === parent) break;
          const swap = items[smallest];
          items[smallest] = items[parent];
          items[parent] = swap;
          parent = smallest;
        }
      }
      return top;
    },
  };
}


/**
 * 从根顶点出发，沿网格边做 Dijkstra，得到每个顶点的测地距离。
 *
 * @param {Array<Array<[number, number]>>} adjacency 邻接表
 * @param {number} rootIndex 起点顶点下标
 * @returns {Float64Array} 与顶点等长的距离数组；不可达顶点为 Infinity
 */
function geodesicDistances(adjacency, rootIndex) {
  const vertexCount = adjacency.length;
  const distances = new Float64Array(vertexCount).fill(Infinity);
  distances[rootIndex] = 0;

  const heap = createMinHeap();
  heap.push(0, rootIndex);

  while (heap.size > 0) {
    const [distance, index] = heap.pop();
    // 过期条目（该顶点已被更短的路径更新过）：直接跳过
    if (distance > distances[index]) continue;

    for (const [neighbour, edgeLength] of adjacency[index]) {
      const candidate = distance + edgeLength;
      if (candidate < distances[neighbour]) {
        distances[neighbour] = candidate;
        heap.push(candidate, neighbour);
      }
    }
  }
  return distances;
}


/**
 * 找出离给定点最近的顶点下标（按静止坐标）。
 *
 * @param {Array<object>} vertices 顶点数组
 * @param {number} x 目标点 X
 * @param {number} y 目标点 Y
 * @param {(index:number)=>boolean} [accept] 可选的额外筛选（例如「必须可达」「必须在关节近端」）
 * @returns {number} 顶点下标；没有满足条件的顶点时返回 -1
 */
function nearestVertexIndex(vertices, x, y, accept) {
  let bestIndex = -1;
  let bestDistanceSq = Infinity;

  for (let i = 0; i < vertices.length; i++) {
    if (accept && !accept(i)) continue;
    const [vx, vy] = restCoord(vertices[i]);
    const dx = vx - x;
    const dy = vy - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = i;
    }
  }
  return bestIndex;
}


/* ══════════════════════════════════════════════════════════════════════════
 * 权重计算
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 基于网格拓扑（测地距离）计算权重 —— 主路径。
 *
 * @param {Array<object>} vertices  顶点数组
 * @param {number} shoulderX,shoulderY 父关节（肩 / 髋）轴心（静止坐标）
 * @param {number} jointX,jointY       子关节（肘 / 膝）轴心（静止坐标）
 * @param {number} blend  过渡带宽度（像素，沿测地距离）
 * @param {Array<Array<number>>} triangles 三角形下标三元组
 * @returns {number[]|null} 权重数组；拓扑不可用时返回 null（由调用方退回直线投影）
 */
function computeGeodesicWeights(vertices, shoulderX, shoulderY, jointX, jointY, blend, triangles) {
  const adjacency = buildRestAdjacency(vertices, triangles);

  // 拓扑可用性检查：三角形全部非法（下标越界 / 空数组）时邻接表会全空，
  // 此时测地距离没有意义，直接放弃主路径，让调用方退回直线投影。
  let connectedCount = 0;
  for (const neighbours of adjacency) {
    if (neighbours.length > 0) connectedCount++;
  }
  if (connectedCount < 2) return null;

  // 轴向：仅用于挑选「根顶点」，不参与权重计算（权重走测地距离）
  const axisDx = jointX - shoulderX;
  const axisDy = jointY - shoulderY;
  const axisLength = Math.hypot(axisDx, axisDy) || 1;
  const axisX = axisDx / axisLength;
  const axisY = axisDy / axisLength;

  /**
   * 根顶点 = 肢体近端起点。
   * 必须限制在「关节近端一侧」（投影 <= 0），否则抬起的胳膊会让手掌比手腕更靠
   * 近肩，根顶点被选到指尖上，整条距离梯度的方向就反了（远端反而成了近端）。
   */
  const isProximalSide = (index) => {
    const [vx, vy] = restCoord(vertices[index]);
    return (vx - jointX) * axisX + (vy - jointY) * axisY <= 0;
  };
  let rootIndex = nearestVertexIndex(vertices, shoulderX, shoulderY, isProximalSide);
  // 退路：一个近端顶点都没有（轴心被拖到了部件之外）→ 就用离肩最近的顶点
  if (rootIndex < 0) rootIndex = nearestVertexIndex(vertices, shoulderX, shoulderY);
  if (rootIndex < 0) return null; // 空网格

  const distances = geodesicDistances(adjacency, rootIndex);

  // 关节锚点 = 离关节轴心最近、且从根顶点可达的网格顶点
  let jointIndex = nearestVertexIndex(vertices, jointX, jointY, (i) => Number.isFinite(distances[i]));
  if (jointIndex < 0) return null; // 整张网格都不可达（没有三角形）→ 交给投影兜底
  const jointDistance = distances[jointIndex];

  // 逐顶点求权重：越过关节（测地距离更大）的一律 1，只在近端 blend 像素内过渡
  const weights = new Array(vertices.length).fill(null);
  const reachable = [];
  for (let i = 0; i < vertices.length; i++) {
    if (!Number.isFinite(distances[i])) continue; // 待补
    weights[i] = clamp01(1 - (jointDistance - distances[i]) / blend);
    reachable.push(i);
  }

  // 孤立小岛（与主网格不连通，例如描边碎块）：跟随最近的「可达」顶点，
  // 避免它们要么被撕裂、要么留在原地成为孤立体。
  if (reachable.length > 0 && reachable.length < vertices.length) {
    for (let i = 0; i < vertices.length; i++) {
      if (weights[i] !== null) continue;
      const [vx, vy] = restCoord(vertices[i]);
      let nearestReachable = reachable[0];
      let bestDistanceSq = Infinity;
      for (const candidate of reachable) {
        const [cx, cy] = restCoord(vertices[candidate]);
        const dx = cx - vx;
        const dy = cy - vy;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          nearestReachable = candidate;
        }
      }
      weights[i] = weights[nearestReachable];
    }
  }

  // 仍有 null（理论上不会走到）→ 用投影兜底，保证返回值永远是 0..1 的数字
  if (weights.some((w) => w === null)) {
    return null;
  }
  return weights;
}


/**
 * 基于「肩→肘」轴线直线投影计算权重 —— 兜底路径（无网格拓扑时使用）。
 *
 * 与主路径保持同一套「只在近端过渡」的形状，避免两条路径行为不一致。
 *
 * @param {Array<object>} vertices 顶点数组
 * @param {number} shoulderX,shoulderY 父关节轴心
 * @param {number} jointX,jointY       子关节轴心
 * @param {number} blend 过渡带宽度
 * @returns {number[]} 权重数组
 */
function computeProjectionWeights(vertices, shoulderX, shoulderY, jointX, jointY, blend) {
  // 轴向 = 单位化的「肩 → 肘」
  const axisDx = jointX - shoulderX;
  const axisDy = jointY - shoulderY;
  const axisLength = Math.hypot(axisDx, axisDy) || 1;
  const axisX = axisDx / axisLength;
  const axisY = axisDy / axisLength;

  return vertices.map((v) => {
    const [x, y] = restCoord(v);
    // 顶点沿肢体轴向、越过关节轴心的带符号距离（>0 表示在关节远端）
    const projection = (x - jointX) * axisX + (y - jointY) * axisY;
    // 与测地距离路径保持同一形状：关节处 1，往近端 blend 像素线性降到 0
    return clamp01(1 + projection / blend);
  });
}


/**
 * 计算关节形变权重（本模块主入口）。
 *
 * @param {Array<{x?:number,y?:number,restX?:number,restY?:number}>} vertices 顶点数组
 * @param {number} shoulderX 父关节（肩 / 髋）轴心 X（静止坐标）
 * @param {number} shoulderY 父关节轴心 Y（静止坐标）
 * @param {number} jointX    子关节（肘 / 膝）轴心 X（静止坐标）
 * @param {number} jointY    子关节轴心 Y（静止坐标）
 * @param {number} [blend=DEFAULT_BLEND] 过渡带宽度（像素），从关节处往父关节方向展开
 * @param {Array<Array<number>>} [triangles=null] 网格三角形下标三元组；
 *        传入时走测地距离（推荐），不传则退回直线投影
 * @returns {number[]} 与 vertices 等长的权重数组，取值 0..1
 */
export function computeLimbWeights(
  vertices,
  shoulderX,
  shoulderY,
  jointX,
  jointY,
  blend = DEFAULT_BLEND,
  triangles = null,
) {
  const list = vertices ?? [];

  // 卫语句：没有顶点，直接返回空数组
  if (list.length === 0) return [];

  // 卫语句：关节与父关节重合，轴向无意义 → 全 0（不形变），避免把部件整体甩飞
  if (isDegenerateJoint(shoulderX, shoulderY, jointX, jointY)) {
    return list.map(() => 0);
  }

  // 过渡带宽度做了防御：非有限值或非正数时回落到默认值
  const safeBlend = Number.isFinite(blend) && blend > 0 ? blend : DEFAULT_BLEND;

  // 主路径：有三角形索引时用测地距离（能正确处理弯曲肢体与小部件）
  if (Array.isArray(triangles) && triangles.length > 0) {
    const geodesic = computeGeodesicWeights(list, shoulderX, shoulderY, jointX, jointY, safeBlend, triangles);
    if (geodesic) return geodesic;
    // 走到这里说明拓扑不可用（索引越界 / 无有效三角形），退回投影并留下排查线索
    console.warn('[limbWeights] 网格拓扑不可用，已退回轴线投影权重（可能造成弯曲肢体权重偏差）');
  }

  // 兜底路径：直线投影
  return computeProjectionWeights(list, shoulderX, shoulderY, jointX, jointY, safeBlend);
}


/**
 * 为「退化」的子关节（肘 / 膝）推导一个合理的轴心位置（自愈修复用）。
 *
 * 思路与 armatureOrganizer 的包围盒估算保持一致：肘 = 肩与腕的中点，
 * 膝 = 髋与踝的中点。锚点的取法与手的朝向无关：
 *   - 'arm'（肘）：腕 ≈ 依赖部件包围盒上离肩最近的点（手通过腕与手臂相连）；
 *   - 'leg'（膝）：踝 ≈ 包围盒上离髋最远的角（腿从髋向外延伸，脚在最远端）。
 *
 * 触发场景：DWPose / 包围盒启发式把肘 / 膝绑到了父关节上（轴长 < MIN_JOINT_AXIS），
 * 此时任何权重都是噪声。与其拒绝形变让用户手动修，不如按部件轮廓把关节放回去。
 *
 * @param {number} parentX 父关节（肩 / 髋）轴心 X
 * @param {number} parentY 父关节轴心 Y
 * @param {Array<{imageBounds?:{minX:number,minY:number,maxX:number,maxY:number}}>} parts
 *        该关节驱动的部件列表（会取全部 imageBounds 的并集）
 * @param {'arm'|'leg'} kind 关节类别
 * @returns {{x:number,y:number}|null} 建议轴心；无法推导（无包围盒，
 *          或推导结果仍退化，例如包围盒把父关节整个包住）时返回 null
 */
export function suggestLimbJointPivot(parentX, parentY, parts, kind = 'arm') {
  // 段落 1：求所有依赖部件包围盒的并集
  // （imageBounds 与骨骼轴心同处 PSD 画布坐标系，无需换算）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const part of parts ?? []) {
    const bounds = part?.imageBounds;
    if (!bounds) continue;
    if (bounds.minX < minX) minX = bounds.minX;
    if (bounds.minY < minY) minY = bounds.minY;
    if (bounds.maxX > maxX) maxX = bounds.maxX;
    if (bounds.maxY > maxY) maxY = bounds.maxY;
  }

  // 卫语句：一个可用包围盒都没有，无法推导，直接放弃
  if (minX === Infinity || maxX === -Infinity) return null;

  // 段落 2：按关节类别取锚点（腕 / 踝）
  let anchorX;
  let anchorY;
  if (kind === 'leg') {
    // 踝 ≈ 离髋最远的那个包围盒角（腿向外延伸，脚在最远端）
    let farthestDistance = -1;
    for (const [cornerX, cornerY] of [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY]]) {
      const distance = (cornerX - parentX) ** 2 + (cornerY - parentY) ** 2;
      if (distance > farthestDistance) {
        farthestDistance = distance;
        anchorX = cornerX;
        anchorY = cornerY;
      }
    }
  } else {
    // 腕 ≈ 包围盒上离肩最近的点：把肩坐标夹到盒内即为最近点
    anchorX = Math.max(minX, Math.min(maxX, parentX));
    anchorY = Math.max(minY, Math.min(maxY, parentY));
  }

  // 段落 3：肘 / 膝 = 父关节与锚点的中点
  const jointX = (Number(parentX) + anchorX) / 2;
  const jointY = (Number(parentY) + anchorY) / 2;

  // 段落 4：结果仍与父关节重合（包围盒套住了父关节，方向没有意义）时放弃自动修复，
  // 回退到「跳过形变 + 提示用户」的旧路径
  if (isDegenerateJoint(parentX, parentY, jointX, jointY)) return null;
  return { x: jointX, y: jointY };
}

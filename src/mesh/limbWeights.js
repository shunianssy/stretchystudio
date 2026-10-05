/**
 * limbWeights.js - 四肢（手臂 / 腿）网格的关节形变权重
 *
 * 这个文件只干一件事：
 *   算出四肢网格上每个顶点该「多跟一点肩 / 髋」还是「多跟一点肘 / 膝」，
 *   这样关节弯曲时部件是平滑过渡的，而不是整块硬邦邦地旋转。
 *
 * 权重含义：0 = 完全跟随父关节（肩 / 髋），1 = 完全跟随子关节（肘 / 膝），中间是过渡带。
 *
 * 对外可调用的方法：
 *   isDegenerateJoint(...)      判断关节轴心是否退化（与父关节几乎重合）
 *   suggestLimbJointPivot(...)  为退化关节推导一个合理的轴心（自愈修复用）
 *   computeLimbWeights(...)     计算权重数组（本模块主入口）
 *
 * 典型调用方式：
 *   const weights = computeLimbWeights(vertices, shoulderX, shoulderY, elbowX, elbowY);
 *   // 返回的数组与 vertices 等长，weights[i] 对应 vertices[i]，取值 0..1
 *
 * 两条必须遵守的铁律（都是踩过坑换来的）：
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
 *   另外，当「肩 → 肘」轴长过短（关节几乎压在父关节上，通常是自动绑定给错了
 *   位置）时，轴向是没有意义的方向，此时任何权重都是噪声。这种情况一律返回
 *   全 0（部件不参与形变），由调用方提示用户先调整关节位置。
 */

/** 轴长小于该值就视为「关节与父关节重合」—— 此时无法定义肢体轴向 */
export const MIN_JOINT_AXIS = 8;

/** 默认过渡带宽度（像素），以子关节为中心向两侧各展开一半 */
export const DEFAULT_BLEND = 40;


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


/**
 * 计算关节形变权重（文件头两条铁律的落地实现，主入口）。
 *
 * @param {Array<{x?:number,y?:number,restX?:number,restY?:number}>} vertices 顶点数组
 * @param {number} shoulderX 父关节（肩 / 髋）轴心 X（静止坐标）
 * @param {number} shoulderY 父关节轴心 Y（静止坐标）
 * @param {number} jointX    子关节（肘 / 膝）轴心 X（静止坐标）
 * @param {number} jointY    子关节轴心 Y（静止坐标）
 * @param {number} [blend=DEFAULT_BLEND] 过渡带宽度（像素），以子关节为中心
 * @returns {number[]} 与 vertices 等长的权重数组，取值 0..1
 */
export function computeLimbWeights(vertices, shoulderX, shoulderY, jointX, jointY, blend = DEFAULT_BLEND) {
  const list = vertices ?? [];

  // 卫语句：没有顶点，直接返回空数组
  if (list.length === 0) return [];

  // 卫语句：关节与父关节重合，轴向无意义 → 全 0（不形变），避免把部件整体甩飞
  if (isDegenerateJoint(shoulderX, shoulderY, jointX, jointY)) {
    return list.map(() => 0);
  }

  // 段落 1：把「肩 → 肘」方向作为肢体轴向
  // 这样无论手臂朝哪个方向，权重都沿肢体分布（而不是沿屏幕 X 轴）
  const axisDx = jointX - shoulderX;
  const axisDy = jointY - shoulderY;
  const axisLength = Math.hypot(axisDx, axisDy) || 1;
  const axisX = axisDx / axisLength;
  const axisY = axisDy / axisLength;

  // 过渡带宽度做了防御：非有限值或非正数时回落到默认值
  const safeBlend = Number.isFinite(blend) && blend > 0 ? blend : DEFAULT_BLEND;

  // 段落 2：逐顶点求权重
  return list.map((v) => {
    // 关键：用静止坐标，保证同一顶点的权重不会因为已发生的形变而漂移
    const [x, y] = restCoord(v);

    // 顶点沿肢体轴向、越过关节轴心的带符号距离：
    // proj < 0 → 落在上臂（跟肩），proj > 0 → 落在前臂（跟肘）
    const proj = (x - jointX) * axisX + (y - jointY) * axisY;

    // 以关节为中心做 ±blend/2 的线性过渡，并夹到 [0, 1]
    return Math.max(0, Math.min(1, proj / safeBlend + 0.5));
  });
}

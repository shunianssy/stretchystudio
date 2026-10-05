/**
 * limbWeights.js
 *
 * 四肢（手臂 / 腿）网格的「关节形变权重」计算。
 *
 * 权重表示每个顶点受**子关节**（肘 / 膝）影响的程度：
 *   0 = 完全跟随父骨骼（肩 / 髋），1 = 完全跟随子关节，中间为过渡。
 *
 * 两个必须遵守的约束（都是踩过坑的）：
 *
 *  1) **必须用静止坐标（restX/restY）计算，而不是当前坐标（x/y）**。
 *     关节轴心（pivot）与顶点都存放在同一套「静止坐标系」里；而 x/y 会被
 *     关节旋转烘焙成已形变的坐标。若用当前坐标重新估算「谁在关节外侧」，
 *     每次拖动都会把混合带切到另一批顶点上 —— 反复拖动后部件会被逐渐剪切
 *     （表现为「扭曲」、被拉长）。restX/restY 自网格生成后不再变化，权重因此稳定。
 *
 *  2) **必须每次用当前轴心重算**，不能把权重烘焙进 mesh。
 *     关节轴心在绑定阶段会被拖动；烘焙过的权重会过期，导致关节两侧顶点按
 *     错误比例旋转，表现为部件扭曲、出现硬折痕（看起来像被切开）。
 *
 *  另外：当「肩 → 肘」的轴长过短（关节几乎压在父关节上，通常是自动绑定
 *  给错了位置）时，轴向是没有意义的方向，此时任何权重都是噪声；
 *  这种情况下返回全 0（部件不参与形变），由调用方提示用户先调整关节位置。
 *
 * @param {Array<{x?:number,y?:number,restX?:number,restY?:number}>} vertices 顶点
 * @param {number} shoulderX 父关节（肩 / 髋）轴心 X（静止坐标）
 * @param {number} shoulderY 父关节轴心 Y（静止坐标）
 * @param {number} jointX    子关节（肘 / 膝）轴心 X（静止坐标）
 * @param {number} jointY    子关节轴心 Y（静止坐标）
 * @param {number} [blend=40] 过渡带宽度（像素），以子关节为中心
 * @returns {number[]} 与 vertices 等长的权重数组，取值 0..1
 */

/** 轴长小于该值视为「关节与父关节重合」—— 无法定义肢体轴向 */
export const MIN_JOINT_AXIS = 8;

/** 默认过渡带宽度（像素） */
export const DEFAULT_BLEND = 40;

/**
 * 判断关节轴心是否退化（与父关节几乎重合）。
 * 调用方可用它决定是否给出「请先调整关节位置」的提示。
 *
 * @returns {boolean} true 表示轴心位置无意义，形变应当跳过
 */
export function isDegenerateJoint(shoulderX, shoulderY, jointX, jointY) {
  const dx = Number(jointX) - Number(shoulderX);
  const dy = Number(jointY) - Number(shoulderY);
  return !Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < MIN_JOINT_AXIS;
}

/**
 * 取顶点用于权重计算的坐标：优先静止坐标，回退到当前坐标。
 * （restX/restY 缺失时说明该顶点是旧数据或新加的，直接用 x/y 兜底。）
 */
function restCoord(v) {
  const rx = v?.restX;
  const ry = v?.restY;
  if (Number.isFinite(rx) && Number.isFinite(ry)) return [rx, ry];
  return [v?.x ?? 0, v?.y ?? 0];
}

/**
 * 为「退化」的子关节（肘 / 膝）推导一个合理的轴心位置（自愈修复用）。
 *
 * 思路与 armatureOrganizer 的包围盒估算一致：肘 = 肩与腕的中点，
 * 膝 = 髋与踝的中点。锚点的取法与手的朝向无关：
 *   - 'arm'（肘）：腕 ≈ 依赖部件包围盒上离肩最近的点（手通过腕与手臂相连）；
 *   - 'leg'（膝）：踝 ≈ 包围盒上离髋最远的角（腿从髋向外延伸，脚在最远端）。
 *
 * 触发场景：DWPose / 包围盒启发式把肘/膝绑到了父关节上（轴长 < MIN_JOINT_AXIS），
 * 此时任何权重都是噪声。与其拒绝形变让用户手动修，不如按部件轮廓把关节放回去。
 *
 * @param {number} parentX 父关节（肩 / 髋）轴心 X
 * @param {number} parentY 父关节轴心 Y
 * @param {Array<{imageBounds?:{minX:number,minY:number,maxX:number,maxY:number}}>} parts
 *        该关节驱动的部件列表（取全部 imageBounds 的并集）
 * @param {'arm'|'leg'} kind 关节类别
 * @returns {{x:number,y:number}|null} 建议轴心；无法推导（无包围盒 /
 *          推导结果仍退化，如包围盒把父关节整个包住）时返回 null
 */
export function suggestLimbJointPivot(parentX, parentY, parts, kind = 'arm') {
  // 所有依赖部件包围盒的并集（imageBounds 与骨骼轴心同处 PSD 画布坐标系）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parts ?? []) {
    const b = p?.imageBounds;
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (minX === Infinity || maxX === -Infinity) return null; // 没有可用包围盒

  let ax, ay;
  if (kind === 'leg') {
    // 踝 ≈ 离髋最远的包围盒角
    let best = -1;
    for (const [cx, cy] of [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY]]) {
      const d = (cx - parentX) ** 2 + (cy - parentY) ** 2;
      if (d > best) { best = d; ax = cx; ay = cy; }
    }
  } else {
    // 腕 ≈ 包围盒上离肩最近的点：把肩坐标夹到盒内即为最近点
    ax = Math.max(minX, Math.min(maxX, parentX));
    ay = Math.max(minY, Math.min(maxY, parentY));
  }

  // 肘 / 膝 = 父关节与锚点的中点；若结果仍与父关节重合（包围盒套住了父关节，
  // 方向没有意义），放弃自动修复，回退到「跳过形变 + 提示用户」的旧路径
  const jx = (Number(parentX) + ax) / 2;
  const jy = (Number(parentY) + ay) / 2;
  if (isDegenerateJoint(parentX, parentY, jx, jy)) return null;
  return { x: jx, y: jy };
}

/**
 * 计算关节形变权重（详见文件头注释）。
 */
export function computeLimbWeights(vertices, shoulderX, shoulderY, jointX, jointY, blend = DEFAULT_BLEND) {
  const list = vertices ?? [];
  if (list.length === 0) return [];

  // 关节与父关节重合：轴向无意义，返回全 0（不形变），避免把部件整体甩飞
  if (isDegenerateJoint(shoulderX, shoulderY, jointX, jointY)) {
    return list.map(() => 0);
  }

  // 肩 → 肘 的方向作为「肢体轴向」，这样无论手臂朝哪个方向，权重都沿肢体分布
  const axDx = jointX - shoulderX;
  const axDy = jointY - shoulderY;
  const axLen = Math.hypot(axDx, axDy) || 1;
  const axX = axDx / axLen;
  const axY = axDy / axLen;

  const band = Number.isFinite(blend) && blend > 0 ? blend : DEFAULT_BLEND;

  return list.map((v) => {
    // 关键：用静止坐标，保证同一顶点的权重不会因为已发生的形变而漂移
    const [x, y] = restCoord(v);
    // 顶点在肢体轴向上越过关节轴心的带符号距离
    const proj = (x - jointX) * axX + (y - jointY) * axY;
    // proj < 0 → 上臂（跟肩），proj > 0 → 前臂（跟肘）
    return Math.max(0, Math.min(1, proj / band + 0.5));
  });
}
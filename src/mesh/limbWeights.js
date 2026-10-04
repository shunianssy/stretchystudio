/**
 * limbWeights.js
 *
 * 四肢（手臂 / 腿）网格的「关节形变权重」计算。
 *
 * 权重表示每个顶点受**子关节**（肘 / 膝）影响的程度：
 *   0 = 完全跟随父骨骼（肩 / 髋），1 = 完全跟随子关节，中间为过渡。
 *
 * 为什么必须是纯函数、并且每次都要用**当前**轴心算：
 *   关节轴心（pivot）在绑定阶段是会被拖动的。如果在"生成网格"那一刻把权重烘焙
 *   进 mesh，之后用户再拖动肘/膝关节，权重就过期了 —— 关节两侧的顶点会按错误的
 *   比例旋转，表现为部件**扭曲 + 出现一道硬折痕（看起来像被切开）**。
 *   因此调用方应当在使用前用当前 pivot 重新调用本函数。
 *
 * @param {Array<{x:number,y:number}>} vertices 顶点（与贴图同坐标系的像素坐标）
 * @param {number} shoulderX 父关节（肩 / 髋）轴心 X
 * @param {number} shoulderY 父关节轴心 Y
 * @param {number} jointX    子关节（肘 / 膝）轴心 X
 * @param {number} jointY    子关节轴心 Y
 * @param {number} [blend=40] 过渡带宽度（像素），以子关节为中心
 * @returns {number[]} 与 vertices 等长的权重数组，取值 0..1
 */
export function computeLimbWeights(vertices, shoulderX, shoulderY, jointX, jointY, blend = 40) {
  const list = vertices ?? [];

  // 肩 → 肘 的方向作为「肢体轴向」，这样无论手臂朝哪个方向，权重都沿肢体分布
  const axDx = jointX - shoulderX;
  const axDy = jointY - shoulderY;
  const axLen = Math.hypot(axDx, axDy) || 1;
  const axX = axDx / axLen;
  const axY = axDy / axLen;

  const band = Number.isFinite(blend) && blend > 0 ? blend : 40;

  return list.map((v) => {
    const x = v?.x ?? 0;
    const y = v?.y ?? 0;
    // 顶点在肢体轴向上越过关节轴心的带符号距离
    const proj = (x - jointX) * axX + (y - jointY) * axY;
    // proj < 0 → 上臂（跟肩），proj > 0 → 前臂（跟肘）
    return Math.max(0, Math.min(1, proj / band + 0.5));
  });
}

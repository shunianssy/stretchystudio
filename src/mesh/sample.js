/**
 * 网格「内部点」采样——纯函数，不依赖 DOM。
 *
 * 作用：在部件的不透明区域内撒下一批内部顶点，让三角化后的网格中间也能被三角形填满，
 * 而不是只有轮廓一圈、内部空心。
 *
 * 对外提供：
 *   sampleInterior(data, width, height, alphaThreshold, gridSpacing) → 内部点数组
 *   filterByEdgePadding(interiorPts, edgePts, minDistance)          → 过滤后的内部点数组
 * 典型调用：
 *   const interior = filterByEdgePadding(
 *     sampleInterior(rgba, w, h, 5, 30),
 *     edgePts, 8,
 *   );
 *
 * 坐标空间：所有点的 x/y 均为 PSD 画布坐标（单位 px），与 mesh / bone / imageBounds 同一套坐标系。
 */


/**
 * 用分层随机采样（抖动网格）在部件内部生成点。
 *
 * 为什么不用严格规则网格：规则网格三角化后会形成过于整齐、「机械」的三角形，
 * 走向也容易与规则方向共振。给每个网格点叠加一点随机抖动，可让三角形分布更自然、更贴合形状。
 *
 * @param {Uint8ClampedArray} data            - 原始 RGBA 像素数据（整张 PSD 画布尺寸）
 * @param {number}            width           - 画布宽（px）
 * @param {number}            height          - 画布高（px）
 * @param {number}            [alphaThreshold=5] - alpha 达到该值才算「内部」，用于过滤近透明像素
 * @param {number}            [gridSpacing=30]   - 网格步长（px），越小点越密、网格越精细
 * @returns {Array<[number,number]>} 内部点列表，每项为 [x, y]（PSD 画布坐标）
 */
export function sampleInterior(data, width, height, alphaThreshold = 5, gridSpacing = 30) {
  const points = [];
  // 抖动幅度取步长的 0.4 倍：既打散规则感，又不至于让相邻点交叉重叠。
  const jitter = gridSpacing * 0.4;

  // 从网格内缩一个步长处开始、到边缘留半步结束，避免采到最外圈（外圈交给轮廓点负责）。
  for (let y = gridSpacing; y < height - gridSpacing / 2; y += gridSpacing) {
    for (let x = gridSpacing; x < width - gridSpacing / 2; x += gridSpacing) {
      // 在网格点上叠加 ±jitter 的随机偏移。
      const jx = x + (Math.random() - 0.5) * jitter * 2;
      const jy = y + (Math.random() - 0.5) * jitter * 2;

      // 抖动后可能越界，夹紧到画布内再取像素判定透明度。
      const cx = Math.max(0, Math.min(width - 1, Math.round(jx)));
      const cy = Math.max(0, Math.min(height - 1, Math.round(jy)));
      // 只有落在不透明区域内（alpha >= 阈值）才保留该点。
      if (data[(cy * width + cx) * 4 + 3] >= alphaThreshold) {
        points.push([jx, jy]);
      }
    }
  }
  return points;
}


/**
 * 剔掉离轮廓点过近的内部点。
 *
 * 为什么要剔：内部点若紧贴轮廓点，三角化会生成又细又长的三角形，
 * 形变时这些三角形容易翻转、撕裂。留出最小间距可让网格更稳定。
 *
 * @param {Array<[number,number]>} interiorPts - 候选内部点（sampleInterior 的输出）
 * @param {Array<[number,number]>} edgePts     - 轮廓点
 * @param {number}                 minDistance - 最小允许间距（px），小于它即丢弃
 * @returns {Array<[number,number]>} 过滤后的内部点
 */
export function filterByEdgePadding(interiorPts, edgePts, minDistance) {
  // 预先平方：循环里用「平方距离比较」省去每次开方，提升逐点过滤的性能。
  const minDist2 = minDistance * minDistance;
  return interiorPts.filter(pt => {
    for (const ep of edgePts) {
      const dx = pt[0] - ep[0];
      const dy = pt[1] - ep[1];
      if (dx * dx + dy * dy < minDist2) return false;
    }
    return true;
  });
}

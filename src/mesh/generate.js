/**
 * 网格生成总调度——把一张图片转成可绑定、可形变的三角网格。
 *
 * 输入：整张 PSD 画布尺寸的 RGBA 像素（Uint8ClampedArray）。
 * 输出：MeshResult = { vertices, uvs, triangles, edgeIndices }
 *   - vertices     ：顶点数组，每项 { x, y, restX, restY }
 *   - uvs          ：扁平 UV 数组 [u0,v0, u1,v1, …]，取值 [0,1]（按画布宽高归一化）
 *   - triangles    ：三角形列表，每项为三个顶点的下标 [i, j, k]
 *   - edgeIndices  ：Set<number>，标记哪些顶点位于轮廓边界上
 *
 * 关于 restX/restY（本项目的关键约定，务必理解）：
 *   每个顶点都额外携带静止坐标 restX/restY，它在网格生成时等于顶点初始 x/y，
 *   此后「永不改变」；顶点当前形变后的位置存在 x/y 里。当需要撤销/重置形变时，
 *   只要把 x/y 写回 restX/restY，就能精确还原未变形的原始形状——这是整个
 *   编辑器能够自愈（任意形变都能回到初始态）的根基。权重计算也以 restX/restY 为基准。
 *
 * 坐标空间：由于部件纹理是整张画布尺寸（导入 PSD 时每个图层按偏移画进 psdW×psdH 画布），
 *   所以这里生成的顶点坐标、骨骼 pivot、imageBounds 天然处在同一套 PSD 画布坐标系，
 *   各模块之间无需做任何坐标换算。
 *
 * 纯模块：不依赖 DOM、不依赖全局状态，既能在主线程跑，也能放进 Web Worker。
 *
 * 对外提供：
 *   generateMesh(data, width, height, opts)  → 从像素数据生成全新网格
 *   retriangulate(vertices, uvs, edgeIndices) → 顶点不变、仅重算三角形连接
 * 典型调用：
 *   import { generateMesh } from './mesh/generate.js';
 *   const mesh = generateMesh(rgba, psdW, psdH, { gridSpacing: 30, numEdgePoints: 80 });
 */
import { dilateAlphaMask, traceAllContours, resampleContour, smoothContour } from './contour.js';
import { sampleInterior, filterByEdgePadding } from './sample.js';
import { triangulate } from './delaunay.js';


/**
 * 在「顶点位置保持不变」的前提下重新三角化。
 *
 * 用途：增删了顶点之后，只需重新计算三角形的连接关系，
 * 顶点的位置与 UV 都要原样保留，避免破坏已烘焙的形变。
 *
 * @param {Array<{x:number,y:number,restX:number,restY:number}>} vertices - 现成顶点（x/y 为当前位置）
 * @param {Float32Array} uvs         - 与 vertices 一一对应的扁平 UV 数组
 * @param {Set<number>}  edgeIndices - 边界顶点下标集合，原样保留
 * @returns {MeshResult}
 */
export function retriangulate(vertices, uvs, edgeIndices) {
  // 卫语句：少于 3 个顶点无法构成三角形，直接原样返回、三角形置空。
  if (vertices.length < 3) {
    return { vertices, uvs, triangles: [], edgeIndices };
  }

  // 从现有顶点里取出 [x, y] 点集交给三角化算法
  const points = vertices.map(v => [v.x, v.y]);

  // 只重算三角形连接，不动顶点
  const triangles = triangulate(points);

  // edgeIndices 原样透传
  return { vertices, uvs, triangles, edgeIndices };
}


/**
 * @typedef {Object} MeshResult
 * @property {Array<{x:number,y:number,restX:number,restY:number}>} vertices - 顶点（x/y 为当前坐标，restX/restY 为静止坐标）
 * @property {Float32Array}                                           uvs        - 扁平 [u0,v0, u1,v1, …]，取值 [0,1]
 * @property {Array<[number,number,number]>}                          triangles  - 三角形顶点下标三元组
 * @property {Set<number>}                                            edgeIndices - 位于边界的顶点下标集合
 */


/**
 * 从原始 RGBA 像素数据生成一张网格。
 *
 * 流程概览：膨胀 alpha 蒙版 → 提取轮廓 → 轮廓重采样/平滑 → 采样内部点 →
 *           合并去重 → Delaunay 三角化 → 输出顶点/UV/三角形。
 *
 * @param {Uint8ClampedArray} data            - 整张 PSD 画布尺寸的 RGBA 像素数据
 * @param {number}            width           - 画布宽（px）
 * @param {number}            height          - 画布高（px）
 * @param {Object}            [opts]
 * @param {number}            [opts.alphaThreshold=5]    - alpha 达到该值才算不透明区域
 * @param {number}            [opts.smoothPasses=0]      - 轮廓拉普拉斯平滑次数
 * @param {number}            [opts.gridSpacing=30]      - 内部采样网格步长（px）
 * @param {number}            [opts.edgePadding=8]       - 内部点与轮廓点需保持的最小间距（px）
 * @param {number}            [opts.numEdgePoints=80]    - 所有轮廓合计分配的边界点数量
 * @returns {MeshResult}
 */
export function generateMesh(data, width, height, opts = {}) {
  const {
    alphaThreshold = 5,
    smoothPasses   = 0,
    gridSpacing    = 30,
    edgePadding    = 8,
    numEdgePoints  = 80,
  } = opts;

  // 段落 1：膨胀 alpha 蒙版。
  //   向外扩 2px，让边界点落在外轮廓之外：纹理的 alpha 会裁掉溢出部分，
  //   于是「网格直线边切进曲线内部」的弦切缺口被遮住，渲染看起来依旧贴合原图。
  const contourMask = dilateAlphaMask(data, width, height, alphaThreshold, 2);

  // 段落 2：提取所有闭合轮廓——每个彼此分离的区域（眼睛、手臂……）各得一条轮廓。
  const contours = traceAllContours(contourMask, width, height);

  // 段落 3：按各轮廓周长占比，分配边界点数量。
  const edgePts = [];
  if (contours.length > 0) {
    // 先算出每条轮廓的周长（轮廓首尾相接，故最后一段要连回起点）。
    const perimeters = contours.map(contour => {
      let perimeter = 0;
      for (let i = 0; i < contour.length; i++) {
        const pointA = contour[i], pointB = contour[(i + 1) % contour.length];
        perimeter += Math.sqrt((pointB[0] - pointA[0]) ** 2 + (pointB[1] - pointA[1]) ** 2);
      }
      return perimeter;
    });
    const totalPerimeter = perimeters.reduce((sum, value) => sum + value, 0);

    for (let contourIndex = 0; contourIndex < contours.length; contourIndex++) {
      // 每条轮廓至少保留 3 个点（成面下限），其余按周长占比分配。
      const share = Math.max(3, Math.round(numEdgePoints * perimeters[contourIndex] / totalPerimeter));
      let resampledPoints = resampleContour(contours[contourIndex], Math.min(share, contours[contourIndex].length));
      resampledPoints = smoothContour(resampledPoints, smoothPasses);
      edgePts.push(...resampledPoints);
    }
  }

  // 段落 4：内部网格点——从原始 alpha 采样，保证各区域内都被填满。
  let interiorPts = sampleInterior(data, width, height, alphaThreshold, Math.max(6, gridSpacing));
  if (edgePadding > 0 && edgePts.length > 0) {
    interiorPts = filterByEdgePadding(interiorPts, edgePts, edgePadding);
  }

  // 段落 5：合并边界点与内部点，并做去重。
  const allPts = [...edgePts, ...interiorPts];
  const rawEdgeCount = edgePts.length;
  const deduped = [];
  const edgeSet = new Set();
  // 去重阈值比较的是「距离的平方」4，即两点直线距离小于 2px 视为同一点。
  // 用平方是为了省去开方，逐点比较时更快。
  const MIN_DIST2 = 4;

  for (let i = 0; i < allPts.length; i++) {
    const [px, py] = allPts[i];
    let dup = false;
    for (const [dx, dy] of deduped) {
      const ex = px - dx, ey = py - dy;
      if (ex * ex + ey * ey < MIN_DIST2) { dup = true; break; }
    }
    if (!dup) {
      // 边界点排在数组最前面（i < rawEdgeCount），去重后若保留下来就登记为边界顶点。
      if (i < rawEdgeCount) edgeSet.add(deduped.length);
      deduped.push([px, py]);
    }
  }

  // 段落 6：Delaunay 三角化。
  const triangles = triangulate(deduped);

  // 段落 7：组装输出。
  //   生成时 x/y 与 restX/restY 相等；restX/restY 此后不再改变，
  //   用于权重计算，以及「把 x/y 重置回 restX/restY」来还原未变形形状。
  const vertices = deduped.map(([x, y]) => ({
    x, y,
    restX: x,
    restY: y,
  }));

  // UV 按画布宽高归一化到 [0,1]。
  const uvs = new Float32Array(deduped.length * 2);
  for (let i = 0; i < deduped.length; i++) {
    uvs[i * 2]     = deduped[i][0] / width;
    uvs[i * 2 + 1] = deduped[i][1] / height;
  }

  return { vertices, uvs, triangles, edgeIndices: edgeSet };
}

/**
 * 网格三角化（Delaunay）——输入一组二维散点，输出把点连成三角形的顶点索引三元组。
 *
 * 为什么用 delaunator：它实现了 Delaunay 三角剖分（任意三角形的外接圆内不含其它点，
 * 三角形尽量「胖」，避免出现又细又长的退化三角形），体积约 3KB、数值稳定，
 * 是社区事实标准。本文件只是它的一层极薄封装：把项目里「点数组」的格式转成
 * delaunator 需要的扁平坐标数组，再把结果整理回三元组。
 *
 * 坐标空间：调用方传入的 x/y 与 mesh 顶点处于同一套 PSD 画布坐标系，本文件不做任何单位/坐标换算。
 *
 * 对外提供：
 *   triangulate(points) → 三角形数组
 * 典型调用：
 *   import { triangulate } from './mesh/delaunay.js';
 *   const triangles = triangulate([[10,20],[30,20],[20,40]]);
 *   // → [[0,1,2]]，每个元素是三个顶点在 points 中的下标
 */
import Delaunator from 'delaunator';


/**
 * 对一组二维散点做 Delaunay 三角剖分。
 *
 * @param {Array<[number,number]>} points - 散点列表，每项为 [x, y]（PSD 画布坐标，单位 px）
 * @returns {Array<[number,number,number]>} 三角形列表；每项是 [i, j, k]，
 *          表示 points 中下标为 i、j、k 的三个点构成一个三角形。
 *          点数不足 3 时无法成面，返回空数组。
 */
export function triangulate(points) {
  // 卫语句：少于 3 个点构不成三角形，直接返回空数组，避免后续无意义的计算。
  if (points.length < 3) return [];

  // delaunator 要求输入是扁平的 [x0,y0, x1,y1, …] 数组，这里做一次格式转换。
  const coords = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    coords[i * 2]     = points[i][0];
    coords[i * 2 + 1] = points[i][1];
  }

  const delaunator = new Delaunator(coords);
  const triangles = [];

  // delaunator 输出的是扁平索引数组（每 3 个一组），这里还原成「三角形数组」的形式。
  for (let i = 0; i < delaunator.triangles.length; i += 3) {
    triangles.push([delaunator.triangles[i], delaunator.triangles[i + 1], delaunator.triangles[i + 2]]);
  }

  return triangles;
}

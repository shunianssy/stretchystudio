/**
 * verify_limb_weights.mjs
 *
 * `src/mesh/limbWeights.js` 的回归测试。
 *
 * 运行：node scripts/verify_limb_weights.mjs
 *
 * 覆盖三类历史事故：
 *   1. 权重被烘焙进 mesh → 关节轴心一改权重就过期（部件扭曲 + 硬折痕）；
 *   2. 用形变后的 x/y 算权重 → 反复拖动后权重漂移（部件被逐渐剪切）；
 *   3. 用「直线投影」量距离 → 弯曲肢体 / 小部件拿错一侧归属，部件被扯成扇形
 *      （用户报的「手部扭曲」）。
 */
import assert from 'node:assert';
import { computeLimbWeights, isDegenerateJoint, suggestLimbJointPivot } from '../src/mesh/limbWeights.js';

let passed = 0;

/**
 * 造一条沿 +X 方向、间距 step 的「链状」网格。
 *
 * @param {number} count 顶点数
 * @param {number} step  间距（px）
 * @returns {{vertices:Array, triangles:Array}} 顶点与三角形下标
 */
function makeChain(count, step) {
  const vertices = [];
  for (let i = 0; i < count; i++) {
    vertices.push({ x: i * step, y: 0, restX: i * step, restY: 0 });
  }
  const triangles = [];
  for (let i = 0; i + 2 < count; i++) triangles.push([i, i + 1, i + 2]);
  return { vertices, triangles };
}

/** 用例 1：过渡带只位于关节「近端」，越过关节的顶点一律刚性跟随（权重 1） */
{
  const { vertices, triangles } = makeChain(11, 20); // x = 0,20,…,200
  const w = computeLimbWeights(vertices, 0, 0, 100, 0, 40, triangles);
  console.log('用例 1 权重：', w.map(v => v.toFixed(2)).join(', '));
  assert.equal(w[0], 0, 'x=0（肩端）应完全不跟随关节');
  assert.equal(w[3], 0, 'x=60（关节近端 blend 之外）应为 0');
  assert.ok(Math.abs(w[4] - 0.5) < 1e-9, `x=80（关节前 20px）应为 0.5，实际 ${w[4]}`);
  assert.equal(w[5], 1, 'x=100（关节处）应为 1（越关节即刚性跟随）');
  assert.equal(w[10], 1, 'x=200（远端）应为 1');
  passed++;
  console.log('✓ 用例 1：关节近端过渡、远端刚性');
}

/** 用例 2（核心回归）：小部件横跨关节轴心时不得被撕裂（手部扭曲的直接原因） */
{
  // 5×? 的方形「手掌」，轴心落在方块内部（模拟手腕被拖到了手套中间）
  const vertices = [
    { x: 90,  y: -30, restX: 90,  restY: -30 },
    { x: 90,  y: 30,  restX: 90,  restY: 30  },
    { x: 170, y: -30, restX: 170, restY: -30 },
    { x: 170, y: 30,  restX: 170, restY: 30  },
  ];
  const triangles = [[0, 1, 2], [1, 2, 3]];
  const w = computeLimbWeights(vertices, 0, 0, 100, 0, 40, triangles);
  console.log('用例 2 权重：', w.map(v => v.toFixed(2)).join(', '));
  assert.deepEqual(w, [1, 1, 1, 1], '整只手掌都在关节远端 → 必须全部刚性跟随，否则会被对折');
  passed++;
  console.log('✓ 用例 2：轴心落在部件内部时，部件整体刚性旋转（不被撕裂）');
}

/** 用例 3（核心回归）：L 形（弯曲）肢体必须沿网格量距离，而不是沿直线投影 */
{
  // 肩(0,0) → 肘(100,0)，之后前臂「折回来」朝 +Y 走（贴图中的弯手臂）
  const vertices = [
    { x: 0,   y: 0,    restX: 0,   restY: 0    }, // 肩端
    { x: 50,  y: 0,    restX: 50,  restY: 0    },
    { x: 100, y: 0,    restX: 100, restY: 0    }, // 肘
    { x: 100, y: -80,  restX: 100, restY: -80  }, // 前臂（几何上「绕回」关节侧方）
    { x: 100, y: -160, restX: 100, restY: -160 },
  ];
  const triangles = [[0, 1, 2], [1, 2, 3], [2, 3, 4]];
  const w = computeLimbWeights(vertices, 0, 0, 100, 0, 40, triangles);
  console.log('用例 3 权重：', w.map(v => v.toFixed(2)).join(', '));
  assert.equal(w[0], 0, '上臂起点应不跟随');
  assert.equal(w[1], 0, '上臂中段应不跟随');
  assert.equal(w[2], 1, '肘部顶点应刚性跟随');
  assert.equal(w[3], 1, '折回的前臂必须刚性跟随（直线投影会误判为 0 → 撕裂）');
  assert.equal(w[4], 1, '前臂末端必须刚性跟随');
  passed++;
  console.log('✓ 用例 3：L 形肢体按测地距离分配权重（不再被扯成扇形）');
}

/** 用例 4：任意朝向（斜向手臂）同样只按沿肢体的距离分配 */
{
  const vertices = [
    { x: 0,   y: 0,   restX: 0,   restY: 0   },
    { x: 50,  y: 50,  restX: 50,  restY: 50  },
    { x: 100, y: 100, restX: 100, restY: 100 }, // 肘
    { x: 150, y: 150, restX: 150, restY: 150 },
  ];
  const triangles = [[0, 1, 2], [1, 2, 3]];
  const w = computeLimbWeights(vertices, 0, 0, 100, 100, 40, triangles);
  console.log('用例 4 权重：', w.map(v => v.toFixed(2)).join(', '));
  assert.equal(w[0], 0);
  assert.equal(w[1], 0);
  assert.equal(w[2], 1);
  assert.equal(w[3], 1);
  passed++;
  console.log('✓ 用例 4：斜向手臂同样正确');
}

/** 用例 5：边界与异常输入 */
{
  assert.deepEqual(computeLimbWeights([], 0, 0, 1, 0), []);
  // 肩与肘重合（退化）时不应除零，且应返回全 0（跳过形变，避免把部件甩飞）
  const w = computeLimbWeights([{ x: 5, y: 5 }], 10, 10, 10, 10);
  assert.ok(Number.isFinite(w[0]), '退化输入应返回有限值');
  assert.equal(w[0], 0, '关节与父关节重合时应跳过形变（全 0）');
  assert.equal(isDegenerateJoint(10, 10, 10, 10), true);
  assert.equal(isDegenerateJoint(0, 0, 100, 0), false);
  // blend 非法时回退到默认 40
  const w2 = computeLimbWeights([{ x: 140, y: 0 }], 0, 0, 100, 0, 0);
  assert.equal(w2[0], 1);
  // 没有 triangles（旧数据）→ 退回直线投影，且不抛异常
  const w3 = computeLimbWeights([{ x: 80, y: 0 }, { x: 140, y: 0 }], 0, 0, 100, 0, 40, null);
  assert.ok(Math.abs(w3[0] - 0.5) < 1e-9, `投影兜底：关节前 20px 应为 0.5，实际 ${w3[0]}`);
  assert.equal(w3[1], 1, '投影兜底：关节远端应为 1');
  // triangles 下标越界（脏数据）→ 同样退回投影，不能把权重全算成 1
  const w4 = computeLimbWeights([{ x: 80, y: 0 }, { x: 140, y: 0 }], 0, 0, 100, 0, 40, [[9, 10, 11]]);
  assert.deepEqual(w4, w3, '非法三角形应被忽略并退回投影兜底');
  passed++;
  console.log('✓ 用例 5：空数组 / 退化关节 / 非法 blend / 无拓扑 都能安全处理');
}

/** 用例 6（核心回归）：权重必须基于静止坐标 restX/restY，而不是被形变过的 x/y */
{
  const { vertices, triangles } = makeChain(11, 20);
  const baseline = computeLimbWeights(vertices, 0, 0, 100, 0, 40, triangles);

  // 同一批顶点：restX/restY 不变，但 x/y 已经被上一次旋转「甩」到别处
  const deformed = vertices.map((v, i) => ({ ...v, x: v.x + 400, y: v.y - 250 + i }));
  const w = computeLimbWeights(deformed, 0, 0, 100, 0, 40, triangles);

  console.log('用例 6 权重：', w.map(v => v.toFixed(2)).join(', '));
  assert.deepEqual(w, baseline, '权重必须与「用静止坐标算出的权重」完全一致');
  passed++;
  console.log('✓ 用例 6：形变后的 x/y 不影响权重（用 restX/restY 计算）');
}

/** 用例 7（核心回归）：关节轴心移动后，权重必须随之改变（这正是不能烘焙的原因） */
{
  const { vertices, triangles } = makeChain(11, 20);
  const before = computeLimbWeights(vertices, 0, 0, 100, 0, 40, triangles);
  const after = computeLimbWeights(vertices, 0, 0, 60, 0, 40, triangles); // 肘被拖到更靠近肩
  console.log('用例 7 肘在 100：', before.map(v => v.toFixed(2)).join(', '),
    ' / 肘拖到 60：', after.map(v => v.toFixed(2)).join(', '));
  assert.notDeepEqual(before, after, '关节轴心变化后权重必须变化');
  passed++;
  console.log('✓ 用例 7：关节轴心变化后权重会更新');
}

/** 用例 8：孤立小岛（与主网格不连通）跟随最近的可达顶点，避免被撕裂或滞留 */
{
  // 主链 x=0..100，另有一个不连通的碎块在 x=0 附近
  const vertices = [
    { x: 0,   y: 0, restX: 0,   restY: 0   },
    { x: 50,  y: 0, restX: 50,  restY: 0   },
    { x: 100, y: 0, restX: 100, restY: 0   },
    { x: 0,   y: 30, restX: 0,  restY: 30  }, // 孤岛
    { x: 10,  y: 30, restX: 10, restY: 30  },
  ];
  const triangles = [[0, 1, 2]]; // 顶点 3、4 没有任何三角形 → 真正的孤立碎块
  const w = computeLimbWeights(vertices, 0, 0, 100, 0, 40, triangles);
  console.log('用例 8 权重：', w.map(v => v.toFixed(2)).join(', '));
  assert.ok(Number.isFinite(w[3]) && Number.isFinite(w[4]), '孤岛顶点必须有有限权重');
  assert.deepEqual(w.slice(3), [w[0], w[0]], '孤岛应跟随最近的连通顶点（x=0 处 → 权重 0）');
  passed++;
  console.log('✓ 用例 8：孤立小岛跟随最近可达顶点');
}

/** 用例 9：退化肘关节的修复建议（arm：腕 = 包围盒上离肩最近的点，肘 = 中点） */
{
  const shoulderX = 100, shoulderY = 300;
  const hand = { imageBounds: { minX: 260, minY: 40, maxX: 340, maxY: 130 } };
  const fix = suggestLimbJointPivot(shoulderX, shoulderY, [hand], 'arm');
  console.log('用例 9 建议肘位：', JSON.stringify(fix));
  assert.deepEqual(fix, { x: 180, y: 215 });
  assert.ok(!isDegenerateJoint(shoulderX, shoulderY, fix.x, fix.y), '修复后的肘位必须非退化');
  passed++;
  console.log('✓ 用例 9：arm 按包围盒最近点推导肘位');
}

/** 用例 10：退化膝关节的修复建议（leg：踝 = 离髋最远的角，膝 = 中点） */
{
  const hipX = 200, hipY = 500;
  const leg = { imageBounds: { minX: 180, minY: 520, maxX: 260, maxY: 800 } };
  const fix = suggestLimbJointPivot(hipX, hipY, [leg], 'leg');
  console.log('用例 10 建议膝位：', JSON.stringify(fix));
  assert.deepEqual(fix, { x: 230, y: 650 });
  passed++;
  console.log('✓ 用例 10：leg 按包围盒最远角推导膝位');
}

/** 用例 11：包围盒把父关节整个包住（方向无意义）/ 无包围盒 → 放弃修复 */
{
  const contained = suggestLimbJointPivot(100, 100,
    [{ imageBounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 } }], 'arm');
  assert.equal(contained, null, '包围盒套住父关节时应返回 null');
  assert.equal(suggestLimbJointPivot(0, 0, [{}], 'arm'), null, '无包围盒时应返回 null');
  assert.equal(suggestLimbJointPivot(0, 0, [], 'arm'), null, '空部件列表应返回 null');
  passed++;
  console.log('✓ 用例 11：无法安全推导时返回 null（回退到跳过+提示路径）');
}

/** 用例 12：多个依赖部件取包围盒并集（手 + 护腕） */
{
  const hand   = { imageBounds: { minX: 200, minY: 100, maxX: 280, maxY: 180 } };
  const bracer = { imageBounds: { minX: 160, minY: 140, maxX: 220, maxY: 200 } };
  // 并集 = (160,100)-(280,200)；肩 (100,150) 在左侧 → 最近点 = (160,150) → 肘 = (130,150)
  const fix = suggestLimbJointPivot(100, 150, [hand, bracer], 'arm');
  assert.deepEqual(fix, { x: 130, y: 150 });
  passed++;
  console.log('✓ 用例 12：多部件包围盒取并集后推导');
}

console.log(`\n[verify-limb-weights] 全部通过（${passed} 项）。`);

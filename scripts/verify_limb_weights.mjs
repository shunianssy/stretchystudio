/**
 * verify_limb_weights.mjs
 *
 * `src/mesh/limbWeights.js` 的回归测试。
 *
 * 运行：node scripts/verify_limb_weights.mjs
 *
 * 重点验证「关节轴心变化后权重必须跟着变」——这正是不再烘焙权重的理由：
 * 早先权重在生成网格时烘焙一次，之后拖动肘/膝关节权重过期，部件就会扭曲、
 * 并出现一道硬折痕（看起来像被切开）。
 */
import assert from 'node:assert';
import { computeLimbWeights, isDegenerateJoint, suggestLimbJointPivot } from '../src/mesh/limbWeights.js';

let passed = 0;

/** 用例 1：沿肢体轴向的权重分布（混合带 ±20px） */
{
  // 肩 (0,0) → 肘 (100,0)，轴向为 +X
  const verts = [
    { x: 0, y: 0 },    // 肩，应完全跟随父骨骼
    { x: 60, y: 0 },   // 关节前 40px → 0
    { x: 80, y: 0 },   // 关节前 20px → 0
    { x: 100, y: 0 },  // 关节处 → 0.5
    { x: 120, y: 0 },  // 关节后 20px → 1
    { x: 160, y: 0 },  // 关节后 60px → 1
  ];
  const w = computeLimbWeights(verts, 0, 0, 100, 0);
  console.log('用例 1 权重：', w.map(v => v.toFixed(2)).join(', '));
  assert.equal(w[0], 0);
  assert.equal(w[1], 0);
  assert.equal(w[2], 0);
  assert.ok(Math.abs(w[3] - 0.5) < 1e-9, `关节处应为 0.5，实际 ${w[3]}`);
  assert.equal(w[4], 1);
  assert.equal(w[5], 1);
  passed++;
  console.log('✓ 用例 1：沿轴向 0 → 0.5 → 1 过渡正确');
}

/** 用例 2：垂直于轴向的偏移不影响权重（只按投影计算） */
{
  const a = computeLimbWeights([{ x: 110, y: 0 }], 0, 0, 100, 0)[0];
  const b = computeLimbWeights([{ x: 110, y: 300 }], 0, 0, 100, 0)[0];
  console.log(`用例 2 垂直偏移：y=0 → ${a.toFixed(3)}，y=300 → ${b.toFixed(3)}`);
  assert.equal(a, b);
  passed++;
  console.log('✓ 用例 2：垂直偏移不影响权重');
}

/** 用例 3（核心回归）：关节轴心移动后，权重必须随之改变 */
{
  const verts = [{ x: 100, y: 0 }, { x: 140, y: 0 }];
  const before = computeLimbWeights(verts, 0, 0, 100, 0);
  const after = computeLimbWeights(verts, 0, 0, 60, 0); // 肘部被拖到更靠近肩
  console.log('用例 3 肘在 100：', before.map(v => v.toFixed(2)).join(', '),
    ' / 肘拖到 60：', after.map(v => v.toFixed(2)).join(', '));
  assert.notDeepEqual(before, after, '关节轴心变化后权重必须变化（这正是不能烘焙的原因）');
  passed++;
  console.log('✓ 用例 3：关节轴心变化后权重会更新');
}

/** 用例 4：任意朝向（斜向手臂）也沿肢体轴分布 */
{
  // 肩 (0,0) → 肘 (100,100)，轴向 45°
  const onAxis = computeLimbWeights([{ x: 100, y: 100 }], 0, 0, 100, 100)[0];
  assert.ok(Math.abs(onAxis - 0.5) < 1e-9, `关节处应为 0.5，实际 ${onAxis}`);
  const far = computeLimbWeights([{ x: 200, y: 200 }], 0, 0, 100, 100)[0];
  assert.equal(far, 1);
  passed++;
  console.log('✓ 用例 4：斜向手臂同样按肢体轴分布');
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
  const w2 = computeLimbWeights([{ x: 120, y: 0 }], 0, 0, 100, 0, 0);
  assert.equal(w2[0], 1);
  passed++;
  console.log('✓ 用例 5：空数组 / 退化关节 / 非法 blend 都能安全处理');
}

/** 用例 6（核心回归）：权重必须基于静止坐标 restX/restY，而不是被形变过的 x/y */
{
  // 同一批顶点：静止位置沿轴分布，但 x/y 已经被上一次旋转「甩」到别处
  const verts = [
    { x: 0,   y: 0,   restX: 0,   restY: 0 },   // 肩
    { x: 900, y: 0,   restX: 100, restY: 0 },   // 关节处
    { x: 900, y: -50, restX: 160, restY: 0 },   // 关节外 60px
  ];
  const restBased = computeLimbWeights(
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 160, y: 0 }], 0, 0, 100, 0);
  const w = computeLimbWeights(verts, 0, 0, 100, 0);
  console.log('用例 6 权重：', w.map(v => v.toFixed(2)).join(', '),
    '（静止坐标基准：', restBased.map(v => v.toFixed(2)).join(', '), '）');
  assert.deepEqual(w, restBased, '权重必须与「用静止坐标算出的权重」一致');
  passed++;
  console.log('✓ 用例 6：形变后的 x/y 不影响权重（用 restX/restY 计算）');
}

/** 用例 7：反复拖动（多次形变）权重保持稳定 */
{
  const make = (dx, dy) => [
    { x: 0 + dx, y: 0 + dy, restX: 0,   restY: 0 },
    { x: 100 + dx, y: 0 + dy, restX: 100, restY: 0 },
    { x: 160 + dx, y: 40 + dy, restX: 160, restY: 0 },
  ];
  const a = computeLimbWeights(make(0, 0), 0, 0, 100, 0);
  const b = computeLimbWeights(make(300, -120), 0, 0, 100, 0);
  const c = computeLimbWeights(make(-80, 260), 0, 0, 100, 0);
  assert.deepEqual(a, b, '拖动一次后权重不应变化');
  assert.deepEqual(a, c, '反复拖动后权重不应漂移');
  passed++;
  console.log('✓ 用例 7：反复拖动后权重不漂移');
}

/** 用例 8：退化肘关节的修复建议（arm：腕 = 包围盒上离肩最近的点，肘 = 中点） */
{
  // 抬起的手：手部包围盒在肩的右上方；DWPose 把肘误检到了肩上（退化）
  const shoulderX = 100, shoulderY = 300;
  const hand = { imageBounds: { minX: 260, minY: 40, maxX: 340, maxY: 130 } };
  const fix = suggestLimbJointPivot(shoulderX, shoulderY, [hand], 'arm');
  // 最近点 = 盒子左下角 (260,130) → 肘 = ((100+260)/2, (300+130)/2) = (180,215)
  console.log('用例 8 建议肘位：', JSON.stringify(fix));
  assert.deepEqual(fix, { x: 180, y: 215 });
  assert.ok(!isDegenerateJoint(shoulderX, shoulderY, fix.x, fix.y), '修复后的肘位必须非退化');
  passed++;
  console.log('✓ 用例 8：arm 按包围盒最近点推导肘位（与手朝向无关）');
}

/** 用例 9：退化膝关节的修复建议（leg：踝 = 离髋最远的角，膝 = 中点） */
{
  const hipX = 200, hipY = 500;
  const leg = { imageBounds: { minX: 180, minY: 520, maxX: 260, maxY: 800 } };
  const fix = suggestLimbJointPivot(hipX, hipY, [leg], 'leg');
  // 最远角 = (260,800)（60²+300²=93600 > 其余角）→ 膝 = ((200+260)/2, (500+800)/2) = (230,650)
  console.log('用例 9 建议膝位：', JSON.stringify(fix));
  assert.deepEqual(fix, { x: 230, y: 650 });
  passed++;
  console.log('✓ 用例 9：leg 按包围盒最远角推导膝位');
}

/** 用例 10：包围盒把父关节整个包住（方向无意义）/ 无包围盒 → 放弃修复 */
{
  const contained = suggestLimbJointPivot(100, 100,
    [{ imageBounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 } }], 'arm');
  assert.equal(contained, null, '包围盒套住父关节时应返回 null');
  assert.equal(suggestLimbJointPivot(0, 0, [{}], 'arm'), null, '无包围盒时应返回 null');
  assert.equal(suggestLimbJointPivot(0, 0, [], 'arm'), null, '空部件列表应返回 null');
  passed++;
  console.log('✓ 用例 10：无法安全推导时返回 null（回退到跳过+提示路径）');
}

/** 用例 11：多个依赖部件取包围盒并集（手 + 护腕） */
{
  const hand   = { imageBounds: { minX: 200, minY: 100, maxX: 280, maxY: 180 } };
  const bracer = { imageBounds: { minX: 160, minY: 140, maxX: 220, maxY: 200 } };
  // 并集 = (160,100)-(280,200)；肩 (100,150) 在左侧 → 最近点 = (160,150) → 肘 = (130,150)
  const fix = suggestLimbJointPivot(100, 150, [hand, bracer], 'arm');
  assert.deepEqual(fix, { x: 130, y: 150 });
  passed++;
  console.log('✓ 用例 11：多部件包围盒取并集后推导');
}

console.log(`\n[verify-limb-weights] 全部通过（${passed} 项）。`);

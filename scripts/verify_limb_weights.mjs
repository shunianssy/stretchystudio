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
import { computeLimbWeights } from '../src/mesh/limbWeights.js';

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
  // 肩与肘重合（退化）时不应除零，结果应有限
  const w = computeLimbWeights([{ x: 5, y: 5 }], 10, 10, 10, 10);
  assert.ok(Number.isFinite(w[0]), '退化输入应返回有限值');
  // blend 非法时回退到默认 40
  const w2 = computeLimbWeights([{ x: 120, y: 0 }], 0, 0, 100, 0, 0);
  assert.equal(w2[0], 1);
  passed++;
  console.log('✓ 用例 5：空数组 / 退化 / 非法 blend 都能安全处理');
}

console.log(`\n[verify-limb-weights] 全部通过（${passed} 项）。`);

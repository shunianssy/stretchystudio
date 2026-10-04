/**
 * verify_split_lr.mjs
 *
 * `src/io/splitLR.js` 中 `findSplitColumn`（列投影谷值切分）的回归测试。
 *
 * 运行：node scripts/verify_split_lr.mjs
 *
 * 覆盖场景：
 *  1. 两个对称部件在上方相连、下方有缝（典型的“裤子/手套”图层）→ 应切在缝处
 *  2. 两个完全分离的部件（中间是真缝隙）→ 应切在缝隙里
 *  3. 实心整体（没有缝）→ 不应切分
 *  4. 左右体量悬殊 → 不应切分（避免切掉一小块）
 *  5. 过窄的主体 → 不应切分
 */
import assert from 'node:assert';
import { findSplitColumn, hasSideSuffix, SPLIT_CANDIDATES } from '../src/io/splitLR.js';
import { matchTag } from '../src/io/psdOrganizer.js';

let passed = 0;

/** 用例 1：模拟真实腿部图层——两团“腿”在腰部相连，中间有一条裆缝 */
{
  const W = 221;
  const cols = new Array(W).fill(0);
  const valleyX = 124; // 258 + 124 = 382（真实数据的裆缝列）
  for (let x = 0; x < W; x++) {
    if (x < 48) cols[x] = Math.round((x / 48) * 200);        // 左腿左侧渐入
    else if (x < 104) cols[x] = 200;                          // 左腿
    else if (x <= 143) cols[x] = 33 + Math.abs(x - valleyX);  // 腰部/裆缝（浅谷）
    else if (x < 200) cols[x] = 200;                          // 右腿
    else cols[x] = Math.round(((W - x) / (W - 200)) * 200);   // 右腿右侧渐出
  }
  const cut = findSplitColumn(cols, 0, W - 1);
  console.log(`用例 1 两腿相连（裆缝在 ${valleyX}）：切分列 = ${cut}`);
  assert.equal(cut, valleyX, '应切在裆缝处');
  const left = cols.slice(0, cut).reduce((a, b) => a + b, 0);
  const right = cols.slice(cut + 1).reduce((a, b) => a + b, 0);
  const ratio = Math.min(left, right) / Math.max(left, right);
  assert.ok(ratio > 0.4, `两侧体量应相当，实际 ${ratio.toFixed(2)}`);
  passed++;
  console.log('✓ 用例 1：两腿相连时按裆缝切分');
}

/** 用例 2：两个完全分离的块 → 切在缝隙里 */
{
  const W = 200;
  const cols = new Array(W).fill(0);
  for (let x = 20; x < 80; x++) cols[x] = 100;
  for (let x = 120; x < 180; x++) cols[x] = 100;
  const cut = findSplitColumn(cols, 20, 179);
  console.log(`用例 2 两分离块：切分列 = ${cut}`);
  assert.ok(cut >= 80 && cut <= 120, `应切在缝隙内，实际 ${cut}`);
  passed++;
  console.log('✓ 用例 2：两个分离块切在缝隙处');
}

/** 用例 3：实心矩形 → 不切分 */
{
  const cut = findSplitColumn(new Array(200).fill(100), 0, 199);
  console.log(`用例 3 实心矩形：切分列 = ${cut}（期望 -1）`);
  assert.equal(cut, -1, '实心整体不应被切分');
  passed++;
  console.log('✓ 用例 3：实心整体不切分');
}

/** 用例 4：左右体量悬殊 → 不切分 */
{
  const W = 200;
  const cols = new Array(W).fill(0);
  for (let x = 0; x < 30; x++) cols[x] = 20;
  for (let x = 30; x < 200; x++) cols[x] = 20;
  cols[30] = 2; // 浅坑，但两侧太小/太大
  const cut = findSplitColumn(cols, 0, W - 1);
  console.log(`用例 4 体量悬殊：切分列 = ${cut}（期望 -1）`);
  assert.equal(cut, -1, '体量悬殊时不应切分');
  passed++;
  console.log('✓ 用例 4：体量悬殊不切分');
}

/** 用例 5：过窄 → 不切分 */
{
  const cut = findSplitColumn(new Array(6).fill(50), 0, 5);
  console.log(`用例 5 过窄主体：切分列 = ${cut}（期望 -1）`);
  assert.equal(cut, -1, '过窄主体不应切分');
  passed++;
  console.log('✓ 用例 5：过窄主体不切分');
}

/** 用例 6：左右后缀识别 + 向导「是否需要拆分」的判定 */
{
  const cases = [
    ['handwear-l', 'handwear', 'l', true],
    ['handwear-r', 'handwear', 'r', true],
    ['handwear_L', 'handwear', 'l', true],
    ['handwear_l', 'handwear', 'l', true],
    ['handwear left', 'handwear', 'l', true],
    ['objects-r', 'objects', 'r', true],
    ['handwear', 'handwear', 'l', false],
    ['handwear-l', 'handwear', 'r', false],
    ['objects', 'objects', 'r', false],
  ];
  for (const [name, base, side, expected] of cases) {
    assert.equal(hasSideSuffix(name, base, side), expected, `hasSideSuffix(${name}, ${base}, ${side})`);
  }
  console.log('用例 6 左右后缀识别：9 个样例全部符合预期');

  // 模拟导入向导的判定：只有「有基名、且没有任何一侧后缀」才算需要拆分。
  // 旧实现用 matchTag 比对，hasL/hasR 恒为 false，会把已拆开的图层二次切分。
  const layers = ['back hair', 'face', 'handwear-l', 'handwear-r', 'legwear', 'objects'];
  const merged = SPLIT_CANDIDATES.filter(base => {
    const hasBase = layers.some(n => matchTag(n) === base);
    const hasL = layers.some(n => hasSideSuffix(n, base, 'l'));
    const hasR = layers.some(n => hasSideSuffix(n, base, 'r'));
    return hasBase && !hasL && !hasR;
  });
  console.log(`用例 6 待拆分基名：${JSON.stringify(merged)}（期望 ["legwear","objects"]）`);
  assert.deepEqual(merged, ['legwear', 'objects'], 'handwear 已拆开不应再拆；legwear/objects 未拆应提示');
  passed++;
  console.log('✓ 用例 6：已拆开的图层不会被二次拆分');
}

console.log(`\n[verify-split-lr] 全部通过（${passed} 项）。`);

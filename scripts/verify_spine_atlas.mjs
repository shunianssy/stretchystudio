/**
 * Spine 图集生成校验脚本
 *
 * 作用：对 `src/io/spine/spineAtlas.js` 的纯计算逻辑做单元校验，
 *       确保打包版面合法（不越界、不重叠）且 .atlas 文本格式符合
 *       libgdx / Spine 4.0 规范（spine-godot 运行时依赖该格式）。
 *
 * 用法：node scripts/verify_spine_atlas.mjs
 * 退出码：0 = 全部通过；1 = 存在失败项
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.resolve(__dirname, '../src/io/spine/spineAtlas.js');

/**
 * 检查同一页内所有区域是否两两不重叠。
 * @param {{x:number,y:number,width:number,height:number}[]} regions
 * @returns {boolean}
 */
function hasNoOverlap(regions) {
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      const overlap = a.x < b.x + b.width && a.x + a.width > b.x &&
                      a.y < b.y + b.height && a.y + a.height > b.y;
      if (overlap) return false;
    }
  }
  return true;
}

/**
 * 检查区域是否全部位于页面范围内。
 * @param {object[]} regions
 * @param {number} pageSize
 * @returns {boolean}
 */
function allWithinBounds(regions, pageSize) {
  return regions.every(r =>
    r.x >= 0 && r.y >= 0 &&
    r.x + r.width <= pageSize &&
    r.y + r.height <= pageSize
  );
}

async function main() {
  const { packRegions, buildAtlasText, DEFAULT_PAGE_SIZE } = await import(pathToFileURL(MODULE_PATH).href);
  let passed = 0;

  // ── 测试 1：小区域应全部放入单页且不越界、不重叠 ──────────────────────
  {
    const items = [
      { name: 'head', width: 200, height: 180 },
      { name: 'hair', width: 150, height: 180 },
      { name: 'body', width: 100, height: 180 },
    ];
    const { pages, skipped } = packRegions(items, 512, 2);
    assert.equal(pages.length, 1, '三个小区域应放入单页');
    assert.equal(skipped.length, 0, '不应有区域被跳过');
    assert.equal(pages[0].regions.length, 3, '单页应包含三个区域');
    assert.ok(allWithinBounds(pages[0].regions, 512), '区域不得越界');
    assert.ok(hasNoOverlap(pages[0].regions), '区域不得重叠');
    passed++;
    console.log('✓ 测试 1：单页打包不越界、不重叠');
  }

  // ── 测试 2：区域超出单页时应自动多页 ─────────────────────────────────
  {
    const items = Array.from({ length: 6 }, (_, i) => ({
      name: `part_${i}`,
      width: 240,
      height: 240,
    }));
    const { pages } = packRegions(items, 512, 2);
    assert.ok(pages.length > 1, '六个 240×240 区域应需要多页');
    for (const page of pages) {
      assert.ok(allWithinBounds(page.regions, 512), '多页模式下区域不得越界');
      assert.ok(hasNoOverlap(page.regions), '多页模式下区域不得重叠');
    }
    const total = pages.reduce((n, p) => n + p.regions.length, 0);
    assert.equal(total, 6, '所有区域都应被打包（不丢失）');
    passed++;
    console.log(`✓ 测试 2：自动分页（${pages.length} 页，共 ${total} 个区域）`);
  }

  // ── 测试 3：超过页面尺寸或尺寸非法的区域应被跳过 ─────────────────────
  {
    const { pages, skipped } = packRegions([
      { name: 'ok', width: 100, height: 100 },
      { name: 'too_wide', width: 4096, height: 100 },
      { name: 'zero', width: 0, height: 100 },
    ], 512);
    assert.deepEqual(skipped.sort(), ['too_wide', 'zero'], '超限与非法尺寸区域应被跳过');
    assert.equal(pages[0].regions.length, 1, '仅合法区域被保留');
    assert.equal(pages[0].regions[0].name, 'ok');
    passed++;
    console.log('✓ 测试 3：超限/非法区域被正确跳过');
  }

  // ── 测试 4：相同输入应产生稳定（可复现）的输出 ───────────────────────
  {
    const items = [
      { name: 'b', width: 100, height: 200 },
      { name: 'a', width: 120, height: 200 },
      { name: 'c', width: 80, height: 90 },
    ];
    const r1 = JSON.stringify(packRegions(items, 512));
    const r2 = JSON.stringify(packRegions([...items].reverse(), 512));
    assert.equal(r1, r2, '相同集合的打包结果应与输入顺序无关');
    passed++;
    console.log('✓ 测试 4：打包结果稳定可复现');
  }

  // ── 测试 5：.atlas 文本格式正确 ──────────────────────────────────────
  {
    const { pages } = packRegions([{ name: 'head', width: 64, height: 32 }], 256);
    const text = buildAtlasText(pages, ['skeleton.png']);
    assert.ok(text.startsWith('skeleton.png\n'), 'atlas 首行应为页面文件名');
    assert.ok(text.includes('size: 256,256'), '应包含页面尺寸');
    assert.ok(text.includes('format: RGBA8888'), '应包含像素格式');
    assert.ok(text.includes('filter: Linear,Linear'), '应包含过滤设置');
    assert.ok(text.includes('repeat: none'), '应包含 repeat 设置');
    assert.ok(/^head$/m.test(text), '应包含区域名行');
    assert.ok(text.includes('  rotate: false'), '区域应包含 rotate');
    assert.ok(/ {2}xy: \d+, \d+/.test(text), '区域应包含 xy 坐标');
    assert.ok(text.includes('  size: 64, 32'), '区域 size 应为原始尺寸（不缩放）');
    assert.ok(text.includes('  orig: 64, 32'), '区域 orig 应等于 size（不裁剪）');
    assert.ok(text.includes('  offset: 0, 0'), '未裁剪时 offset 应为 0,0');
    assert.ok(text.includes('  index: -1'), '应包含 index: -1');
    assert.ok(text.endsWith('\n'), '文件应以换行结尾');
    passed++;
    console.log('✓ 测试 5：.atlas 文本格式符合 Spine 规范');
  }

  // ── 测试 6：多页时页面文件名与页面数量必须一致 ───────────────────────
  {
    const { pages } = packRegions([{ name: 'a', width: 200, height: 200 }], 256);
    assert.throws(() => buildAtlasText(pages, []), '页面文件名数量不匹配应抛错');
    assert.throws(() => buildAtlasText([], []), '空页面应抛错');
    passed++;
    console.log('✓ 测试 6：参数校验（文件名数量/空页面）');
  }

  // ── 测试 7：默认页面尺寸常量正确 ─────────────────────────────────────
  {
    assert.equal(DEFAULT_PAGE_SIZE, 2048, '默认页面尺寸应为 2048');
    const { pages } = packRegions([{ name: 'x', width: 10, height: 10 }]);
    assert.equal(pages[0].width, 2048, '未传 pageSize 时应使用默认值');
    passed++;
    console.log('✓ 测试 7：默认页面尺寸');
  }

  console.log(`\n[verify-spine-atlas] 全部通过（${passed} 项）。`);
}

main().catch(error => {
  console.error('\n[verify-spine-atlas] 校验失败：', error);
  process.exit(1);
});

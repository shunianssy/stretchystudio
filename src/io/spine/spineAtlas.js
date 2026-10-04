/**
 * spineAtlas.js
 *
 * Spine 图集（.atlas）生成工具，面向 Spine 4.0 与 spine-godot 运行时。
 *
 * 背景：Spine Editor 可以直接从一堆独立 PNG 目录导入贴图，但 spine-godot
 * 运行时只认「图集描述文件（*.atlas）+ 一张或多张图集页面（PNG）」。
 * 因此导出的 ZIP 必须同时包含 skeleton.json、skeleton.atlas 与图集页面。
 *
 * 设计约束：
 *  - 本模块只做纯计算（版面打包 + 文本生成），不触碰任何浏览器 API，
 *    以便通过 node 脚本（scripts/verify_spine_atlas.mjs）直接做单元校验。
 *  - 区域不做裁剪（trim）、不做缩放，保证图集区域与原始图像 1:1，
 *    `size == orig` 且 `offset == 0,0`，避免 Spine 运行时的裁剪偏移歧义。
 *
 * @module io/spine/spineAtlas
 */

/**
 * 默认图集页面尺寸（正方形，像素）。
 *
 * 使用较大的单页可以规避 spine-godot 4.3 的多页图集缺陷：实测当图集存在多页时，
 * 靠后页面的区域会无法绘制（部件“消失”）。2048 单页仅能容纳 4 个 768×768 区域，
 * 因此默认提高到 4096（可容纳 5×5=25 个 768×768 区域），保证常规角色仍是单页。
 */
export const DEFAULT_PAGE_SIZE = 4096;
/** 相邻区域之间的默认间距（像素），防止线性采样时互相串色 */
export const DEFAULT_PADDING = 2;

/**
 * @typedef {Object} AtlasRegion
 * @property {string} name   - 区域名（必须与 skeleton.json 中的附件名一致）
 * @property {number} x      - 区域左边缘在图集页面中的像素坐标（左上为原点）
 * @property {number} y      - 区域上边缘在图集页面中的像素坐标
 * @property {number} width  - 区域宽度（像素）
 * @property {number} height - 区域高度（像素）
 */

/**
 * @typedef {Object} AtlasPage
 * @property {number} width  - 页面宽度（像素）
 * @property {number} height - 页面高度（像素）
 * @property {AtlasRegion[]} regions - 该页面内的区域列表
 */

/**
 * 使用「货架式（shelf）」算法把矩形区域打包到一页或多页图集中。
 *
 * 算法说明：先按高度降序排序，再逐行从左到右摆放（类似书架），
 * 当前行放不下就换行，当前页放不下就新开一页。实现简单、结果可复现，
 * 对本工具「按部件切图」的场景已足够；若后续需要更高利用率可替换为 MaxRects。
 *
 * @param {{name: string, width: number, height: number}[]} items - 待打包区域
 * @param {number} [pageSize=DEFAULT_PAGE_SIZE] - 单页边长（像素）
 * @param {number} [padding=DEFAULT_PADDING] - 区域间距（像素）
 * @returns {{pages: AtlasPage[], skipped: string[]}} 打包结果与被跳过的区域名
 * @throws {TypeError} 当 items 不是数组时抛出
 */
export function packRegions(items, pageSize = DEFAULT_PAGE_SIZE, padding = DEFAULT_PADDING) {
  if (!Array.isArray(items)) {
    throw new TypeError('packRegions: items 必须是数组');
  }

  // 参数兜底：非法页面尺寸退回默认值，避免除零/死循环
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE;
  const gap = Number.isFinite(padding) && padding >= 0 ? Math.floor(padding) : DEFAULT_PADDING;

  const valid = [];
  const skipped = [];

  for (const item of items) {
    if (!item) {
      skipped.push('unnamed');
      continue;
    }
    const width = Math.ceil(Number(item.width) || 0);
    const height = Math.ceil(Number(item.height) || 0);
    const name = item.name ?? 'unnamed';

    // 尺寸非法的区域直接跳过
    if (width <= 0 || height <= 0) {
      skipped.push(name);
      continue;
    }
    // 单张图就超过页面尺寸，无法放入任何页面
    if (width > size || height > size) {
      skipped.push(name);
      continue;
    }
    valid.push({ name, width, height });
  }

  // 高度降序（同高按名称升序），保证打包结果稳定可复现
  valid.sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));

  const pages = [];
  let page = null;
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  /** 新开一页并重置光标 */
  const startPage = () => {
    page = { width: size, height: size, regions: [] };
    pages.push(page);
    cursorX = 0;
    cursorY = 0;
    rowHeight = 0;
  };
  startPage();

  for (const item of valid) {
    // 当前行剩余宽度不足 → 换行
    if (cursorX + item.width + gap > size) {
      cursorX = 0;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    // 当前页剩余高度不足 → 换页
    if (cursorY + item.height + gap > size) {
      startPage();
    }

    page.regions.push({
      name: item.name,
      x: cursorX,
      y: cursorY,
      width: item.width,
      height: item.height,
    });

    cursorX += item.width + gap;
    if (item.height > rowHeight) rowHeight = item.height;
  }

  return { pages, skipped };
}

/**
 * 生成 libgdx/Spine 格式的 .atlas 文本内容。
 *
 * 由于打包时不裁剪、不缩放，`size` 与 `orig` 相同、`offset` 恒为 `0,0`，
 * 因此骨架中的网格 UV（归一化到单张图像空间）会被 Spine 运行时正确地
 * 映射到图集区域内，无需在导出侧重算 UV。
 *
 * @param {AtlasPage[]} pages - packRegions 产出的页面
 * @param {string[]} pageFileNames - 与 pages 一一对应的页面 PNG 文件名
 * @returns {string} .atlas 文件文本（以换行结尾）
 * @throws {Error} 参数为空或长度不匹配时抛出
 */
export function buildAtlasText(pages, pageFileNames) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('buildAtlasText: 至少需要一页图集');
  }
  if (!Array.isArray(pageFileNames) || pageFileNames.length !== pages.length) {
    throw new Error('buildAtlasText: pageFileNames 数量必须与 pages 一致');
  }

  const blocks = pages.map((page, index) => {
    const lines = [
      pageFileNames[index],
      `size: ${page.width},${page.height}`,
      'format: RGBA8888',
      'filter: Linear,Linear',
      'repeat: none',
    ];

    // 区域名排序，保证输出稳定、便于 diff
    const regions = [...(page.regions ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const r of regions) {
      lines.push(r.name);
      lines.push('  rotate: false');
      lines.push(`  xy: ${r.x}, ${r.y}`);
      lines.push(`  size: ${r.width}, ${r.height}`);
      lines.push(`  orig: ${r.width}, ${r.height}`);
      lines.push('  offset: 0, 0');
      lines.push('  index: -1');
    }

    return lines.join('\n');
  });

  // 页与页之间必须用「空行」分隔：libgdx/Spine 的图集解析器以空行作为一页的
  // 结束标志，缺少空行时后续页面会被误解析，导致区域找不到 / 部件不渲染。
  return `${blocks.join('\n\n')}\n`;
}

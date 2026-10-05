/**
 * exportSpine.js —— 把 Stretchy Studio 工程导出为 Spine 4.3 JSON 资源包。
 *
 * ── 这个文件负责什么 ────────────────────────────────────────────────
 * 读取 projectStore 的工程快照，生成「Spine 三件套」并打包成一个 ZIP：
 *   1. skeleton.json（或骨架数据）  骨骼 / 插槽 / 皮肤 / 动画
 *   2. skeleton.atlas               图集描述文件
 *   3. skeleton.png（多页时 skeleton2.png、skeleton3.png …）  图集页面
 *
 * ── 对外可调用的方法（本文件只有一个导出） ───────────────────────────
 * exportToSpine({ project, godotNaming, onProgress }) → Promise<Blob>
 *   - project     {object}    projectStore.project 的只读快照
 *   - godotNaming {boolean}   true  → 数据文件名为 `skeleton.spine-json`（spine-godot 专用）
 *                             false → 数据文件名为 `skeleton.json`（Spine Editor 用）
 *   - onProgress  {(msg: string) => void} 可选进度回调
 *
 * ── 典型调用（见 ExportModal.jsx） ──────────────────────────────────
 *   const { exportToSpine } = await import('@/io/exportSpine');
 *   const zipBlob = await exportToSpine({ project, godotNaming: true, onProgress });
 *   const url = URL.createObjectURL(zipBlob);   // 交给浏览器下载
 *
 * ── 关于版本与命名（踩坑记录，改动前务必读完） ───────────────────────
 *   1. 数据里声明 spine:"4.3.17"，运行时必须使用 spine-godot 4.3
 *      （运行时 major.minor 必须与骨架版本一致）；上游 4.0 分支没有 spine-godot。
 *   2. Godot 端骨架文件名必须是 `skeleton.spine-json`：若用 `.json`，会被 Godot 自带
 *      的 JSON 导入器抢走，spine-godot 找不到资源；而 Spine Editor 只认 `.json`。
 *      两者由 godotNaming 开关切换。
 *   3. 图集单页尺寸 DEFAULT_PAGE_SIZE 必须为 4096；低于 4096（旧版 2048）会把图集
 *      拆成多页，而 spine-godot 4.3 对多页图集有缺陷：靠后页面的区域无法绘制
 *      （表现为部件「消失」）。导出面板会显示实际生效值并在 <4096 时黄色告警。
 */
import { computeWorldMatrices, mat3Inverse, mat3Mul, mat3Identity } from '@/renderer/transforms';
import { t } from '@/i18n';
import { packRegions, buildAtlasText, DEFAULT_PAGE_SIZE } from './spine/spineAtlas.js';


/** 导出文件名前缀：骨架数据 / 图集 / 页面必须同名，Spine 运行时才能自动匹配 */
const BASE_NAME = 'skeleton';


/**
 * Spine 导出的唯一入口：生成并返回一个包含「骨架数据 + 图集描述 + 图集页面」的 ZIP Blob。
 *
 * 业务意图：把工程快照转换成 Spine 4.3 可加载的资源包，供 Godot(spine-godot) 或 Spine Editor 使用。
 *
 * @param {object}   params
 * @param {object}   params.project                projectStore.project 的只读快照
 * @param {boolean}  [params.godotNaming=false]    true → 数据文件为 `skeleton.spine-json`（spine-godot 专用）；
 *                                                 false → `skeleton.json`（Spine Editor 专用）
 * @param {(msg: string) => void} [params.onProgress] 进度回调（用于 UI 文案）
 * @returns {Promise<Blob>} ZIP 文件 Blob（可直接交给浏览器下载）
 */
export async function exportToSpine({ project, godotNaming = false, onProgress }) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  // 段落 1：收集并解码全部部件贴图（决定后续图集能容纳什么）
  onProgress?.(t('io.progress.collectingTextures'));
  const collectedTextures = await collectPartTextures(project, onProgress);

  // 卫语句：没有任何可用贴图时仍继续导出骨架数据，仅告警（便于只导出骨骼/动画）。
  if (collectedTextures.length === 0) {
    console.warn('[Spine Export] 未找到可用贴图，将仅导出骨架数据。');
  }

  // 段落 2：按单页尺寸打包图集版面，得到页面划分与被跳过的超大区域
  onProgress?.(t('io.progress.packingAtlas'));
  const { pages, skipped } = packRegions(
    collectedTextures.map(c => ({ name: c.regionName, width: c.width, height: c.height })),
    DEFAULT_PAGE_SIZE
  );
  if (skipped.length > 0) {
    console.warn(`[Spine Export] 以下区域因尺寸超过图集页面被跳过：${skipped.join(', ')}`);
  }
  // 为什么强调单页：spine-godot 4.3 加载多页图集时，靠后页面的区域可能无法绘制。
  // 默认 4096 单页已能容纳 25 个 768×768 区域；若仍超出，说明部件过多，
  // 建议缩小单部件贴图后再导出。
  if (pages.length > 1) {
    console.warn(
      `[Spine Export] 图集被拆分为 ${pages.length} 页，部分 Godot 运行时可能无法绘制靠后页面。建议减少部件数或缩小贴图以保持单页。`
    );
  }

  // 只保留真正进入图集的部件，避免运行时因「区域不存在」加载失败
  const skippedSet = new Set(skipped);
  const availableIds = new Set(
    collectedTextures.filter(c => !skippedSet.has(c.regionName)).map(c => c.part.id)
  );

  // 段落 3：生成骨架 JSON 并写入 ZIP（数据文件名按目标工具选择）
  onProgress?.(t('io.progress.preparingSkeletonData'));
  const skeletonData = buildSpineJson(project, availableIds);
  // spine-godot 只识别 `.spine-json`（`.json` 会被 Godot 自身的 JSON 导入器抢走），
  // 而 Spine Editor 需要 `.json`；因此按目标工具选择数据文件名。
  const dataFileName = godotNaming ? 'skeleton.spine-json' : 'skeleton.json';
  zip.file(dataFileName, JSON.stringify(skeletonData, null, 2));
  onProgress?.(t('io.progress.skeletonFileNamed', { filename: dataFileName }));

  // 段落 4：逐页绘制图集 PNG 并写入 ZIP
  const pageFileNames = pages.map((_, i) => (i === 0 ? `${BASE_NAME}.png` : `${BASE_NAME}${i + 1}.png`));
  const textureByRegion = new Map(collectedTextures.map(c => [c.regionName, c]));

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(t('io.progress.writingAtlasPage', { filename: pageFileNames[i] }));
    try {
      const blob = await renderAtlasPage(pages[i], textureByRegion);
      if (blob) zip.file(pageFileNames[i], blob);
    } catch (err) {
      // 单页失败不应中断整个导出，记录后继续
      console.error(`[Spine Export] 图集页面 ${pageFileNames[i]} 生成失败：`, err);
    }
  }

  // 段落 5：写入 .atlas 描述文件（各页之间由 buildAtlasText 用空行分隔，
  // libgdx/Spine 正是靠空行判断页边界，切勿删掉空行）
  zip.file(`${BASE_NAME}.atlas`, buildAtlasText(pages, pageFileNames));

  // 段落 6：打包为 ZIP，并释放解码图片占用的显存/内存
  onProgress?.(t('io.progress.generatingZip'));
  try {
    return await zip.generateAsync({ type: 'blob' });
  } finally {
    // 释放 ImageBitmap 占用的显存/内存
    for (const c of collectedTextures) c.bitmap?.close?.();
  }
}


/**
 * 收集工程中所有部件的贴图，并解码为可绘制对象（ImageBitmap 或 HTMLImageElement）。
 *
 * 业务意图：把「部件 → 贴图文件」解析成图集打包所需的尺寸信息。
 * 去重规则：同一区域名（sanitizeName 之后）只保留第一个，避免图集出现重名区域
 *           （重名区域 Spine 无法区分，运行时行为不确定）。
 *
 * @param {object} project                        工程快照
 * @param {(msg: string) => void} [onProgress]    进度回调
 * @returns {Promise<Array<{part: object, regionName: string, bitmap: any, width: number, height: number}>>}
 *          每项：part 部件节点 / regionName 图集区域名 / bitmap 解码结果 / width·height 像素尺寸
 */
async function collectPartTextures(project, onProgress) {
  const items = [];
  const seenNames = new Set();

  for (const node of project.nodes ?? []) {
    // 卫语句：只处理部件节点
    if (node.type !== 'part') continue;

    // 贴图可能直接挂在部件 id 上，也可能通过 textureId 引用，按优先级查找
    const tex = project.textures?.find(x => x.id === node.id) || project.textures?.find(x => x.id === node.textureId);
    // 卫语句：没有贴图源的部件直接跳过
    if (!tex?.source) continue;

    const regionName = sanitizeName(node.name);
    // 卫语句：区域名重复时跳过后续同名部件
    if (seenNames.has(regionName)) {
      console.warn(`[Spine Export] 区域名重复 "${regionName}"（部件 "${node.name}"），已跳过后续同名部件。`);
      continue;
    }

    try {
      const response = await fetch(tex.source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const bitmap = await decodeImage(blob);
      const width = bitmap.naturalWidth || bitmap.width || 0;
      const height = bitmap.naturalHeight || bitmap.height || 0;
      // 尺寸为 0 说明解码异常，直接失败以免污染图集
      if (!width || !height) {
        bitmap.close?.();
        throw new Error('图像尺寸为 0');
      }

      items.push({ part: node, regionName, bitmap, width, height });
      seenNames.add(regionName);
      onProgress?.(t('io.progress.packingImage', { filename: regionName }));
    } catch (err) {
      // 单个贴图失败不影响其余部件
      console.warn(`[Spine Export] 贴图加载失败（部件 "${node.name}"）：`, err);
    }
  }

  return items;
}


/**
 * 解码图片 Blob 为可绘制对象。
 * 优先使用 createImageBitmap（解码更快、不占用 DOM），不支持时回退到 <img>。
 *
 * @param {Blob} blob 图片二进制
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function decodeImage(blob) {
  // 卫语句：支持 createImageBitmap 时走快路径
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(blob);
  }

  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = url;
    });
  } finally {
    // 无论成功失败都要释放 objectURL，否则泄漏
    URL.revokeObjectURL(url);
  }
}


/**
 * 把一页图集的全部区域 1:1 绘制到离屏画布并编码为 PNG。
 *
 * @param {import('./spine/spineAtlas.js').AtlasPage} page 图集页面（含像素坐标的区域列表）
 * @param {Map<string, {bitmap: any, width: number, height: number}>} textureByRegion 区域名 → 已解码贴图
 * @returns {Promise<Blob|null>} 页面 PNG；该页没有任何有效区域时返回 null
 */
async function renderAtlasPage(page, textureByRegion) {
  const { canvas, ctx } = createCanvas(page.width, page.height);
  let drawnRegionCount = 0;

  for (const region of page.regions) {
    const tex = textureByRegion.get(region.name);
    // 卫语句：缺少贴图的区域跳过并告警
    if (!tex) {
      console.warn(`[Spine Export] 图集页面缺少区域 "${region.name}" 的贴图，已跳过。`);
      continue;
    }
    try {
      // 不裁剪、不缩放，1:1 绘制到目标位置
      ctx.drawImage(tex.bitmap, 0, 0, tex.width, tex.height, region.x, region.y, region.width, region.height);
      drawnRegionCount++;
    } catch (err) {
      console.warn(`[Spine Export] 绘制区域 "${region.name}" 失败：`, err);
    }
  }

  // 卫语句：整页都没画上，返回 null，调用方据此跳过该页
  if (drawnRegionCount === 0) return null;
  return await canvasToPngBlob(canvas);
}


/**
 * 创建用于绘制图集的离屏画布：优先 OffscreenCanvas（不挂 DOM，性能更好），
 * 回退到普通 <canvas>。
 *
 * @param {number} width  画布宽（像素）
 * @param {number} height 画布高（像素）
 * @returns {{canvas: OffscreenCanvas|HTMLCanvasElement, ctx: CanvasRenderingContext2D}}
 */
function createCanvas(width, height) {
  // 卫语句：具备 OffscreenCanvas 时走无 DOM 快路径
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, ctx: canvas.getContext('2d') };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}


/**
 * 把画布编码为 PNG Blob。
 *
 * @param {OffscreenCanvas|HTMLCanvasElement} canvas 待编码画布
 * @returns {Promise<Blob>}
 */
async function canvasToPngBlob(canvas) {
  // OffscreenCanvas 用 convertToBlob，普通 canvas 用回调式 toBlob
  if (typeof canvas.convertToBlob === 'function') {
    return await canvas.convertToBlob({ type: 'image/png' });
  }
  return await new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('画布编码 PNG 失败'))), 'image/png');
  });
}


/**
 * 构建 Spine 4.3 JSON 数据结构（骨架 / 骨骼 / 插槽 / 皮肤 / 动画）。
 *
 * ── 坐标系说明（改动前务必理解，这是最容易出错的地方） ────────────────
 *   Stretchy Studio(SS)：Y 轴向下，原点在左上角，节点矩阵存的是「父级局部空间」；
 *     computeWorldMatrices 给出的世界矩阵 m[6]/m[7] 表示「节点局部原点(0,0)」在画布中的位置。
 *   Spine：Y 轴向上。骨骼 x/y 是「相对父骨骼、且已去除父骨骼朝向」的局部偏移。
 *
 *   画布坐标 → Spine 世界坐标（画布高 H）：
 *     spineWorldX = canvasWorldX
 *     spineWorldY = H - canvasWorldY
 *
 *   子骨骼相对父骨骼的偏移：
 *     offset = 父骨骼世界矩阵线性部分的逆 · (子世界 pivot − 父世界 pivot)，再翻转 Y。
 *   注意：不是简单的世界坐标相减 —— 父骨骼带旋转/缩放时两者不同。
 *
 * @param {object} project                            工程快照（含 canvas / nodes / animations）
 * @param {Set<string>|null} [availablePartIds=null]  成功进入图集的部件 id 集合；
 *        为 null 时不过滤（供测试/独立调用）。被过滤的部件不会出现在插槽/皮肤/动画中，
 *        否则运行时会因引用不存在的区域而加载失败。
 * @returns {{skeleton: object, bones: object[], slots: object[], skins: object[], animations: object}}
 *          Spine 4.3 JSON 顶层结构
 */
function buildSpineJson(project, availablePartIds = null) {
  const { width: canvasW, height: canvasH } = project.canvas;
  const nodes = project.nodes;

  /** 判断部件是否已成功写入图集（availablePartIds 为 null 时全部视为可用） */
  const isPartAvailable = (part) => !availablePartIds || availablePartIds.has(part.id);

  // 段落 1：建立节点索引，并准备「骨骼解析 / 世界坐标 / 局部偏移」三个工具函数
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // 向上回溯最近的「骨骼节点」：只有 type === 'group' 的节点会被导出为 Spine bone。
  // 部件的父节点可能是 warp / deformer 等形变层，它们不会成为骨骼；
  // 若把形变层名直接写进 slot.bone 或 bone.parent，Spine 运行时会报
  // “Bone/Slot not found”，因此这里统一回溯到最近的 group（找不到则挂到 root）。
  const resolveBoneNode = (node) => {
    let cur = node?.parent ? nodeMap.get(node.parent) : null;
    while (cur) {
      if (cur.type === 'group') return cur;
      cur = cur.parent ? nodeMap.get(cur.parent) : null;
    }
    return null;
  };

  // 计算世界矩阵：Spine 中没有 warp / deformer 层，必须用「世界坐标」计算偏移，
  // 否则形变层引入的位移会丢失，部件之间会错位（表现为各部件散开）。
  const worldMatrices = computeWorldMatrices(nodes);

  // 节点「轴心点（pivot）」的世界坐标（画布坐标，Y 向下，单位：像素）。
  // 注意：矩阵平移列 m[6]/m[7] 是节点局部原点 (0,0) 的像，而不是轴心点
  // (pivotX,pivotY) 的像。当节点 pivot 非零但旋转/缩放为 0（本项目导入的分组大多如此）
  // 时 m[6]/m[7] 恒为 0，会把所有骨骼塌缩到原点，导致动画围绕画布原点旋转、部件乱飞。
  // 这里必须显式用世界矩阵变换轴心点。
  const worldPivot = (node) => {
    const pivotX = node.transform?.pivotX ?? 0;
    const pivotY = node.transform?.pivotY ?? 0;
    const worldMatrix = worldMatrices.get(node.id);
    if (!worldMatrix) {
      // 退化兜底：没有世界矩阵时按局部坐标处理
      return { x: (node.transform?.x ?? 0) + pivotX, y: (node.transform?.y ?? 0) + pivotY };
    }
    return { x: worldMatrix[0] * pivotX + worldMatrix[3] * pivotY + worldMatrix[6], y: worldMatrix[1] * pivotX + worldMatrix[4] * pivotY + worldMatrix[7] };
  };

  // 画布坐标（Y 向下）→ Spine 世界坐标（Y 向上）；单位保持像素。
  const toSpineWorld = (p) => ({ x: p.x, y: canvasH - p.y });

  // 相对父骨骼的局部偏移（Spine bone.x/y 语义，单位像素，Y 向上）。
  // Spine 的骨骼局部坐标是「在父骨骼本地朝向中」的偏移，而画布里子父关节的
  // 世界差是画布朝向；父骨骼若带旋转/缩放，必须先用父骨骼累计线性部分的逆
  // 把该偏移换算到父骨骼本地朝向，最后再翻转 Y。
  const getLocalSpineOffset = (node, parentBoneNode) => {
    const childPivot = worldPivot(node);
    // 卫语句：顶层骨骼没有父骨骼，直接翻转到 Spine 世界坐标
    if (!parentBoneNode) {
      return toSpineWorld(childPivot);
    }
    const parentPivot = worldPivot(parentBoneNode);
    let dx = childPivot.x - parentPivot.x;
    let dy = childPivot.y - parentPivot.y;

    // 用父骨骼世界矩阵的线性部分求逆，把画布朝向的世界差换算到父骨骼本地朝向
    const parentWorldMatrix = worldMatrices.get(parentBoneNode.id);
    if (parentWorldMatrix) {
      const determinant = parentWorldMatrix[0] * parentWorldMatrix[4] - parentWorldMatrix[1] * parentWorldMatrix[3];
      // 行列式接近 0 说明矩阵退化（缩放到 0），保持原偏移避免除零
      if (Math.abs(determinant) > 1e-8) {
        const inverseDeterminant = 1 / determinant;
        const localOffsetX = ( parentWorldMatrix[4] * dx - parentWorldMatrix[3] * dy) * inverseDeterminant;
        const localOffsetY = (-parentWorldMatrix[1] * dx + parentWorldMatrix[0] * dy) * inverseDeterminant;
        dx = localOffsetX;
        dy = localOffsetY;
      }
    }
    // 画布 Y 向下 → Spine Y 向上
    return { x: dx, y: -dy };
  };

  // 段落 2：骨架元信息
  const skeleton = {
    spine: "4.3.17",   // 骨架版本：运行时 major.minor 必须与之一致（本项目用 spine-godot 4.3）
    hash: Math.random().toString(36).slice(2),   // 随机哈希，仅用于标识导出批次
    name: "Exported Skeleton",
    width: canvasW,
    height: canvasH,
    fps: 24,
  };

  // 段落 3：导出骨骼。Spine 要求每个文件必须有且仅有一个无父级的 "root" 骨骼。
  const groups = nodes.filter(n => n.type === 'group');
  const bones = [{ name: 'root' }];
  const processedBones = new Set(['root']);
  let remaining = [...groups];

  // 多轮扫描，确保「父骨骼先于子骨骼」写入：每轮只处理父级已就绪的骨骼。
  // 之所以不用简单递归：工程里存在父子乱序甚至环状引用，多轮扫描能稳妥处理。
  while (remaining.length > 0) {
    const startCount = remaining.length;
    remaining = remaining.filter(group => {
      const parentBone = resolveBoneNode(group);
      const parentName = parentBone ? sanitizeName(parentBone.name) : 'root';
      if (!processedBones.has(parentName)) return true; // 父骨骼还没处理，留到下一轮

      const transform = group.transform || {};
      const localOffset = getLocalSpineOffset(group, parentBone);

      bones.push({
        name: sanitizeName(group.name),
        parent: parentName,
        x: localOffset.x,
        y: localOffset.y,
        rotation: -(transform.rotation || 0),   // SS 顺时针 → Spine 逆时针
        scaleX: transform.scaleX ?? 1,
        scaleY: transform.scaleY ?? 1,
      });
      processedBones.add(sanitizeName(group.name));
      return false;
    });

    // 一轮下来没有任何骨骼被处理，说明剩余骨骼存在环 / 缺父级，兜底全部挂到 root
    if (remaining.length === startCount) {
      remaining.forEach(g => {
        const localOffset = getLocalSpineOffset(g, null);
        bones.push({ name: sanitizeName(g.name), parent: 'root', x: localOffset.x, y: localOffset.y });
        processedBones.add(sanitizeName(g.name));
      });
      break;
    }
  }

  // 段落 4：导出插槽（一个部件 = 一个 slot，draw_order 决定绘制顺序）
  const parts = [...nodes]
    .filter(n => n.type === 'part' && isPartAvailable(n))
    .sort((a, b) => (a.draw_order ?? 0) - (b.draw_order ?? 0));

  // slot.bone 必须是已导出的骨骼名：回溯到最近的 group，找不到则用 root
  const slots = parts.map(part => {
    const boneNode = resolveBoneNode(part);
    return {
      name: sanitizeName(part.name),
      bone: boneNode ? sanitizeName(boneNode.name) : 'root',
      attachment: sanitizeName(part.name),
    };
  });

  // 段落 5：导出皮肤与附件几何
  // Spine 的附件几何（region 的 x/y、mesh 的 vertices）都是「相对所属骨骼」的
  // 局部坐标：先经部件的世界矩阵得到画布世界点，再减去所属骨骼的轴心，
  // 最后翻转 Y（Stretchy Studio 为 Y 向下，Spine 为 Y 向上）。
  //
  // 常见坑：
  //  ① 直接写画布绝对坐标 → 角色上下颠倒；且骨骼旋转时部件绕画布原点乱飞；
  //  ② 只做 Y 翻转、却不减去骨骼轴心 → 每个部件被自己的骨骼轴心平移一次，
  //     结果按骨骼分组“散开”（每个骨骼一组）。
  const skinAttachments = {};

  /** 应用 3×3 仿射矩阵到点（列主序：m[0..2] 第一列 … m[6],m[7] 为平移） */
  const applyMat = (m, x, y) => ({
    x: m[0] * x + m[3] * y + m[6],
    y: m[1] * x + m[4] * y + m[7],
  });

  /**
   * 返回「部件局部 → 所属骨骼本地坐标系」的 3×3 矩阵（画布坐标，Y 仍向下）。
   *
   * 骨骼本地系 = 以骨骼轴心为原点、且与画布同向（不含骨骼自身旋转）的坐标系。
   * 必须用 `Wb⁻¹`（骨骼世界矩阵的逆）做完整逆变换，而不是简单的世界坐标相减：
   * 骨骼带旋转/缩放时两者不同，直接相减会让部件在骨骼旋转后位置错乱。
   */
  const boneLocalMatrix = (part, boneNode) => {
    const partWorldMatrix = worldMatrices.get(part.id) ?? mat3Identity();
    // 卫语句：无骨骼时直接用部件世界矩阵（视为挂在 root 下）
    if (!boneNode) return partWorldMatrix;
    const boneWorldMatrix = worldMatrices.get(boneNode.id);
    // 卫语句：骨骼无世界矩阵时退化为部件世界矩阵
    if (!boneWorldMatrix) return partWorldMatrix;
    return mat3Mul(mat3Inverse(boneWorldMatrix), partWorldMatrix);
  };

  /** 骨骼在「自身本地坐标系」中的轴心（即节点自己的 pivot，单位：像素） */
  const localPivot = (node) => ({
    x: node?.transform?.pivotX ?? 0,
    y: node?.transform?.pivotY ?? 0,
  });

  for (const part of parts) {
    const boneNode = resolveBoneNode(part);
    const boneToPartMatrix = boneLocalMatrix(part, boneNode); // 部件局部 → 骨骼本地（画布朝向）
    const bonePivot = localPivot(boneNode);
    const imgW = part.imageWidth ?? canvasW;
    const imgH = part.imageHeight ?? canvasH;

    /** 骨骼本地坐标 → Spine 顶点：以骨骼轴心为原点，并翻转 Y（Spine 为 Y 向上） */
    const toSpineVertex = (u) => ({ x: u.x - bonePivot.x, y: -(u.y - bonePivot.y) });

    const attachment = {
      type: "region",
      name: sanitizeName(part.name),
      // 位置与旋转已全部烘焙进几何（region 用中心点、mesh 用顶点），
      // 因此此处不再单独设置 rotation，避免重复旋转。
      x: 0,
      y: 0,
      width: imgW,
      height: imgH,
    };

    if (part.mesh) {
      attachment.type = "mesh";
      // Spine 要求 vertices 是扁平的 [x0,y0,x1,y1,...] 数字数组；
      // 项目内部 mesh.vertices 是 {x,y,restX,restY} 对象数组，必须在此拍平，
      // 否则生成的是对象数组，Spine 运行时解析会崩溃。
      const flatVertices = [];
      for (const v of part.mesh.vertices ?? []) {
        const boneLocalPoint = applyMat(boneToPartMatrix, v?.x ?? 0, v?.y ?? 0); // 骨骼本地坐标
        const spineVertex = toSpineVertex(boneLocalPoint);
        flatVertices.push(spineVertex.x, spineVertex.y);
      }
      attachment.vertices = flatVertices;
      // uvs / triangles 可能是 TypedArray，统一转成普通数组以保证 JSON 序列化正确
      attachment.uvs = Array.from(part.mesh.uvs ?? []);
      // Spine 的 triangles 是扁平索引数组 [i0,i1,i2, i3,i4,i5, ...]；
      // 项目内部是 [[i,j,k], ...] 三元组数组，必须拍平
      const flatTriangles = [];
      for (const tri of part.mesh.triangles ?? []) {
        if (Array.isArray(tri)) {
          flatTriangles.push(tri[0] ?? 0, tri[1] ?? 0, tri[2] ?? 0);
        } else {
          flatTriangles.push(tri);
        }
      }
      attachment.triangles = flatTriangles;
    } else {
      // 非网格附件：图片以中心为锚点，换算到骨骼本地并翻转 Y
      const boneLocalPoint = applyMat(boneToPartMatrix, imgW / 2, imgH / 2);
      const spineVertex = toSpineVertex(boneLocalPoint);
      attachment.x = spineVertex.x;
      attachment.y = spineVertex.y;
    }

    const slotKey = sanitizeName(part.name);
    if (!skinAttachments[slotKey]) skinAttachments[slotKey] = {};
    skinAttachments[slotKey][slotKey] = attachment;
  }

  const skins = [{ name: "default", attachments: skinAttachments }];

  // 段落 6：导出动画
  // 设计原则：用「单骨架 + 多 animation（Idle/Walk/Talk/Attack…）+ 多 skin」表达
  // 服装/表情变化，避免为每个动作复制骨架；动画名需稳定、唯一、可枚举，
  // 尽量用英文/数字，避免被 sanitizeName 改写导致引用不上。
  const animations = {};

  for (const anim of project.animations) {
    const animName = sanitizeName(anim.name);
    const spineAnim = { bones: {}, slots: {} };

    // 先把轨道按节点聚合：一个节点可能有多条轨道（x / y / rotation / scale…）
    const tracksByNode = {};
    for (const track of anim.tracks) {
      if (!tracksByNode[track.nodeId]) tracksByNode[track.nodeId] = [];
      tracksByNode[track.nodeId].push(track);
    }

    for (const [nodeId, nodeTracks] of Object.entries(tracksByNode)) {
      const node = nodes.find(n => n.id === nodeId);
      // 卫语句：节点已被删除，跳过其轨道
      if (!node) continue;

      // 只有 group（骨骼）与 part（插槽）在 Spine 中有对应对象；
      // warp / deformer 等形变层不存在于 Spine，其轨道必须跳过，
      // 否则时间轴会引用不存在的骨骼/插槽导致运行时加载失败
      if (node.type !== 'group' && node.type !== 'part') continue;

      const targetName = sanitizeName(node.name);
      const isBone = node.type === 'group';

      if (isBone) {
        if (!spineAnim.bones[targetName]) spineAnim.bones[targetName] = {};
        const boneEntry = spineAnim.bones[targetName];

        for (const track of nodeTracks) {
          if (track.property === 'x' || track.property === 'y') {
            // 位移：Spine 存「相对 setup 姿态的增量」，且 Y 方向与 SS 相反
            if (!boneEntry.translate) boneEntry.translate = [];
            for (const kf of track.keyframes) {
              const time = kf.time / 1000; // 毫秒 → 秒
              // 时间点相同的 x/y 关键帧合并到同一条目的 x、y 上
              let entry = boneEntry.translate.find(e => Math.abs(e.time - time) < 0.001);
              if (!entry) { entry = { time, x: 0, y: 0 }; boneEntry.translate.push(entry); }
              const setup = node.transform[track.property] ?? 0;
              const delta = kf.value - setup;
              if (track.property === 'x') entry.x = delta;
              else entry.y = -delta;   // Y 翻转
              applySpineCurve(entry, kf);
            }
          } else if (track.property === 'rotation') {
            // 旋转：Spine 存「相对 setup 的增量」，方向取反（SS 顺时针 → Spine 逆时针）
            if (!boneEntry.rotate) boneEntry.rotate = [];
            for (const kf of track.keyframes) {
              const setup = node.transform.rotation ?? 0;
              const entry = { time: kf.time / 1000, value: -(kf.value - setup) };
              applySpineCurve(entry, kf);
              boneEntry.rotate.push(entry);
            }
          } else if (track.property === 'scaleX' || track.property === 'scaleY') {
            // 缩放：Spine 存「相对 setup 的比例」，故用除法而非减法
            if (!boneEntry.scale) boneEntry.scale = [];
            for (const kf of track.keyframes) {
              const time = kf.time / 1000;
              let entry = boneEntry.scale.find(e => Math.abs(e.time - time) < 0.001);
              if (!entry) { entry = { time, x: 1, y: 1 }; boneEntry.scale.push(entry); }
              const setup = node.transform[track.property] ?? 1;
              if (track.property === 'scaleX') entry.x = kf.value / setup;
              else entry.y = kf.value / setup;
              applySpineCurve(entry, kf);
            }
          }
        }

        // Spine 要求时间轴按 time 升序排列
        boneEntry.translate?.sort((a, b) => a.time - b.time);
        boneEntry.rotate?.sort((a, b) => a.time - b.time);
        boneEntry.scale?.sort((a, b) => a.time - b.time);

      } else {
        // 部件已被图集跳过时其插槽不存在，需同步跳过插槽动画，
        // 否则 Spine 运行时会因引用未知插槽而报错
        if (!isPartAvailable(node)) continue;

        // 插槽动画只处理不透明度（opacity → rgba 颜色通道的 alpha）
        if (!spineAnim.slots[targetName]) spineAnim.slots[targetName] = {};
        const slotEntry = spineAnim.slots[targetName];

        for (const track of nodeTracks) {
          if (track.property === 'opacity') {
            if (!slotEntry.rgba) slotEntry.rgba = [];
            for (const kf of track.keyframes) {
              const hexA = Math.round(kf.value * 255).toString(16).padStart(2, '0');
              // 注意：插槽 rgba 时间轴刻意不写 curve。
              // 实测 spine-godot 4.3 的 GDExtension（4.6.1-stable 预编译包）在解析
              // 带 curve 的 rgba 时间轴时会发生段错误（signal 11），
              // 因此这里统一按线性插值导出，保证运行时可正常加载。
              slotEntry.rgba.push({ time: kf.time / 1000, color: `ffffff${hexA}` });
            }
            slotEntry.rgba.sort((a, b) => a.time - b.time);
          }
        }
      }
    }

    animations[animName] = spineAnim;
  }

  return { skeleton, bones, slots, skins, animations };
}


/**
 * 把名字清洗成 Spine 可安全使用的标识符（只保留字母 / 数字 / 下划线 / 连字符）。
 * 原因：骨骼名、插槽名、动画名、附件名都参与引用匹配，含空格/中文/特殊符号会
 * 引用不上或被运行时拒绝，重名还可能导致互相覆盖。
 * 特例："root" 是 Spine 保留的根骨骼名，用户节点若也叫 root 会冲突，故改写为 rig_root。
 *
 * @param {string} [name] 原始名字
 * @returns {string} 清洗后的名字（空名回退为 "item"）
 */
function sanitizeName(name) {
  const sanitizedName = (name ?? 'item')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitizedName === 'root' ? 'rig_root' : sanitizedName;
}


/**
 * 把项目的缓动（easing）转换成 Spine 关键帧的 curve 字段。
 * Spine 的 curve 支持：'stepped'（阶跃）或四元贝塞尔控制点数组（平滑）。
 *
 * @param {object} entry Spine 时间轴条目（就地写入 curve）
 * @param {object} kf    项目关键帧（含 easing 描述）
 */
function applySpineCurve(entry, kf) {
  // 卫语句：线性即 Spine 默认插值，无需写 curve
  if (kf.easing === 'linear') return;
  if (kf.easing === 'stepped') {
    entry.curve = 'stepped';
  } else if (Array.isArray(kf.easing) && kf.easing.length === 4) {
    // 已是四元贝塞尔控制点，直接使用
    entry.curve = kf.easing;
  } else if (kf.easing === 'ease-in') {
    entry.curve = [0.42, 0, 1, 1];
  } else if (kf.easing === 'ease-out') {
    entry.curve = [0, 0, 0.58, 1];
  } else {
    // 默认 / 'ease-both' / 'ease' → 缓入缓出
    entry.curve = [0.42, 0, 0.58, 1];
  }
}

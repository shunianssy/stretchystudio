/**
 * exportSpine.js
 *
 * Logic to export the Plianca Studio project to Spine 4.0 JSON format.
 *
 * 输出内容（Spine / spine-godot 标准三件套）：
 *   - skeleton.json  骨架 + 动画数据
 *   - skeleton.atlas 图集描述文件
 *   - skeleton.png   图集页面（多页时依次为 skeleton2.png、skeleton3.png …）
 *
 * 关于版本：skeleton.json 声明 `spine: "4.0"`，因此运行时必须使用
 * **4.0.x** 的 spine-godot（运行时 major.minor 必须与骨架版本一致）。
 */
import { t } from '@/i18n';
import { packRegions, buildAtlasText, DEFAULT_PAGE_SIZE } from './spine/spineAtlas.js';

/** 导出文件名前缀，需与 Spine 惯例一致（数据/图集/页面同名，运行时才能自动匹配） */
const BASE_NAME = 'skeleton';

/**
 * Main entry point for Spine export.
 * Returns a ZIP blob containing skeleton.json, skeleton.atlas and the atlas page(s).
 *
 * @param {object} params
 * @param {object} params.project - projectStore.project 快照
 * @param {(msg: string) => void} [params.onProgress] - 进度回调
 * @returns {Promise<Blob>} ZIP blob
 */
export async function exportToSpine({ project, onProgress }) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  // ── 1. 收集并解码部件贴图 ─────────────────────────────────────────────
  onProgress?.(t('io.progress.collectingTextures'));
  const collected = await collectPartTextures(project, onProgress);

  if (collected.length === 0) {
    console.warn('[Spine Export] 未找到可用贴图，将仅导出骨架数据。');
  }

  // ── 2. 计算图集版面 ──────────────────────────────────────────────────
  onProgress?.(t('io.progress.packingAtlas'));
  const { pages, skipped } = packRegions(
    collected.map(c => ({ name: c.regionName, width: c.width, height: c.height })),
    DEFAULT_PAGE_SIZE
  );
  if (skipped.length > 0) {
    console.warn(`[Spine Export] 以下区域因尺寸超过图集页面被跳过：${skipped.join(', ')}`);
  }

  // 仅保留成功进入图集的部件，避免运行时因「区域不存在」而加载失败
  const skippedSet = new Set(skipped);
  const availableIds = new Set(
    collected.filter(c => !skippedSet.has(c.regionName)).map(c => c.part.id)
  );

  // ── 3. 生成并写入骨架数据 ────────────────────────────────────────────
  onProgress?.(t('io.progress.preparingSkeletonData'));
  const skeletonData = buildSpineJson(project, availableIds);
  zip.file('skeleton.json', JSON.stringify(skeletonData, null, 2));

  // ── 4. 绘制并写入图集页面 ────────────────────────────────────────────
  const pageFileNames = pages.map((_, i) => (i === 0 ? `${BASE_NAME}.png` : `${BASE_NAME}${i + 1}.png`));
  const textureByRegion = new Map(collected.map(c => [c.regionName, c]));

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

  // ── 5. 写入 .atlas 描述文件 ──────────────────────────────────────────
  zip.file(`${BASE_NAME}.atlas`, buildAtlasText(pages, pageFileNames));

  onProgress?.(t('io.progress.generatingZip'));
  try {
    return await zip.generateAsync({ type: 'blob' });
  } finally {
    // 释放 ImageBitmap 占用的显存/内存
    for (const c of collected) c.bitmap?.close?.();
  }
}

/**
 * 收集项目中所有部件贴图并解码为可绘制对象。
 * 同一区域名（sanitizeName 后）只保留第一个，避免图集出现重名区域。
 *
 * @param {object} project
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<Array<{part: object, regionName: string, bitmap: any, width: number, height: number}>>}
 */
async function collectPartTextures(project, onProgress) {
  const items = [];
  const seenNames = new Set();

  for (const node of project.nodes ?? []) {
    if (node.type !== 'part') continue;

    const tex = project.textures?.find(x => x.id === node.id) || project.textures?.find(x => x.id === node.textureId);
    if (!tex?.source) continue;

    const regionName = sanitizeName(node.name);
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
      if (!width || !height) {
        bitmap.close?.();
        throw new Error('图像尺寸为 0');
      }

      items.push({ part: node, regionName, bitmap, width, height });
      seenNames.add(regionName);
      onProgress?.(t('io.progress.packingImage', { filename: regionName }));
    } catch (err) {
      console.warn(`[Spine Export] 贴图加载失败（部件 "${node.name}"）：`, err);
    }
  }

  return items;
}

/**
 * 解码图片 Blob。优先使用 createImageBitmap（性能更好），
 * 不支持时回退到 <img> + objectURL。
 *
 * @param {Blob} blob
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function decodeImage(blob) {
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
    URL.revokeObjectURL(url);
  }
}

/**
 * 把一页图集的所有区域绘制到离屏画布并编码为 PNG。
 *
 * @param {import('./spine/spineAtlas.js').AtlasPage} page
 * @param {Map<string, {bitmap: any, width: number, height: number}>} textureByRegion
 * @returns {Promise<Blob|null>} 页面 PNG；若该页无任何有效区域则返回 null
 */
async function renderAtlasPage(page, textureByRegion) {
  const { canvas, ctx } = createCanvas(page.width, page.height);
  let drawn = 0;

  for (const region of page.regions) {
    const tex = textureByRegion.get(region.name);
    if (!tex) {
      console.warn(`[Spine Export] 图集页面缺少区域 "${region.name}" 的贴图，已跳过。`);
      continue;
    }
    try {
      // 不裁剪、不缩放，1:1 绘制到目标位置
      ctx.drawImage(tex.bitmap, 0, 0, tex.width, tex.height, region.x, region.y, region.width, region.height);
      drawn++;
    } catch (err) {
      console.warn(`[Spine Export] 绘制区域 "${region.name}" 失败：`, err);
    }
  }

  if (drawn === 0) return null;
  return await canvasToPngBlob(canvas);
}

/**
 * 创建离屏画布，优先使用 OffscreenCanvas，回退到普通 canvas。
 *
 * @param {number} width
 * @param {number} height
 * @returns {{canvas: OffscreenCanvas|HTMLCanvasElement, ctx: CanvasRenderingContext2D}}
 */
function createCanvas(width, height) {
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
 * @param {OffscreenCanvas|HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
async function canvasToPngBlob(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    return await canvas.convertToBlob({ type: 'image/png' });
  }
  return await new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('画布编码 PNG 失败'))), 'image/png');
  });
}

/**
 * Builds the Spine 4.0 JSON structure.
 *
 * Coordinate system:
 *   SS  — Y-down, origin top-left, transforms are stored in parent-local space
 *         (computeWorldMatrices gives true world canvas positions via mat[6/7])
 *   Spine — Y-up. Each bone's x/y is in the parent bone's local space (no rotation for setup pose).
 *
 * Conversion for a canvas of height H:
 *   spineWorldX = canvasWorldX
 *   spineWorldY = H - canvasWorldY
 *
 * Bone offset from parent:
 *   boneX = childSpineWorldX - parentSpineWorldX
 *   boneY = childSpineWorldY - parentSpineWorldY
 */
function buildSpineJson(project, availablePartIds = null) {
  const { width: canvasW, height: canvasH } = project.canvas;
  const nodes = project.nodes;

  // 仅保留已成功写入图集的部件；为 null 时不过滤（供测试/独立调用）
  const isPartAvailable = (part) => !availablePartIds || availablePartIds.has(part.id);

  // ── World positions ───────────────────────────────────────────────────────
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

  // Spine expects bone setup coordinates (x,y) to be local to the parent bone.
  // In Plianca Studio, a node's local transform places its pivot at (x + pivotX, y + pivotY)
  // within its parent's un-transformed internal coordinate space.
  // The distance from the parent bone's pivot to this node's pivot is then:
  // dx = (node.x + node.pivotX) - parentBone.pivotX
  // dy = (node.y + node.pivotY) - parentBone.pivotY
  const getLocalSpineOffset = (node, parentBoneNode) => {
    const nx = (node.transform?.x ?? 0) + (node.transform?.pivotX ?? 0);
    const ny = (node.transform?.y ?? 0) + (node.transform?.pivotY ?? 0);

    // 无父骨骼时挂到 Spine 的 root（0,0），局部偏移即其世界坐标
    if (!parentBoneNode) {
      return { x: nx, y: canvasH - ny };
    }

    const px = parentBoneNode.transform?.pivotX ?? 0;
    const py = parentBoneNode.transform?.pivotY ?? 0;

    return {
      x: nx - px,
      y: -(ny - py) // Flip Y for Spine's coordinate system
    };
  };


  // ── 1. Skeleton info ──────────────────────────────────────────────────────
  const skeleton = {
    spine: "4.3.17",
    hash: Math.random().toString(36).slice(2),
    name: "Exported Skeleton",
    width: canvasW,
    height: canvasH,
    fps: 24,
  };

  // ── 2. Bones ──────────────────────────────────────────────────────────────
  // Spine requires every file to have a bone named exactly "root" with no parent.
  const groups = nodes.filter(n => n.type === 'group');
  const bones = [{ name: 'root' }];
  const processedBones = new Set(['root']);
  let remaining = [...groups];

  while (remaining.length > 0) {
    const startCount = remaining.length;
    remaining = remaining.filter(group => {
      const parentBone = resolveBoneNode(group);
      const parentName = parentBone ? sanitizeName(parentBone.name) : 'root';
      if (!processedBones.has(parentName)) return true; // parent not yet processed

      const t = group.transform || {};
      const pos = getLocalSpineOffset(group, parentBone);

      bones.push({
        name: sanitizeName(group.name),
        parent: parentName,
        x: pos.x,
        y: pos.y,
        rotation: -(t.rotation || 0),   // SS CW → Spine CCW
        scaleX: t.scaleX ?? 1,
        scaleY: t.scaleY ?? 1,
      });
      processedBones.add(sanitizeName(group.name));
      return false;
    });

    if (remaining.length === startCount) {
      // Cycle / missing parent — attach orphans directly to root
      remaining.forEach(g => {
        const pos = getLocalSpineOffset(g, null);
        bones.push({ name: sanitizeName(g.name), parent: 'root', x: pos.x, y: pos.y });
        processedBones.add(sanitizeName(g.name));
      });
      break;
    }
  }

  // ── 3. Slots ──────────────────────────────────────────────────────────────
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

  // ── 4. Skins ──────────────────────────────────────────────────────────────
  // Region attachment x/y = center of the image in the parent bone's local space.
  // We get this by taking the part's world canvas position (which is the pivot
  // point — typically image center) and expressing it relative to the parent bone.
  const skinAttachments = {};

  for (const part of parts) {
    const t = part.transform || {};
    const boneNode = resolveBoneNode(part);
    const pos = getLocalSpineOffset(part, boneNode);  // pivot offset relative to the parent bone's pivot

    const attachment = {
      type: "region",
      name: sanitizeName(part.name),
      x: pos.x,
      y: pos.y,
      rotation: -(t.rotation || 0),
      width: part.imageWidth ?? canvasW,
      height: part.imageHeight ?? canvasH,
    };

    if (part.mesh) {
      attachment.type = "mesh";
      // Spine 要求 vertices 是扁平的 [x0,y0,x1,y1,...] 数字数组；
      // 项目内部 mesh.vertices 是 {x,y,restX,restY} 对象数组，必须在此拍平，
      // 否则生成的是对象数组，Spine 运行时解析会崩溃。
      const flatVertices = [];
      for (const v of part.mesh.vertices ?? []) {
        flatVertices.push(v?.x ?? 0, v?.y ?? 0);
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
    }

    const slotKey = sanitizeName(part.name);
    if (!skinAttachments[slotKey]) skinAttachments[slotKey] = {};
    skinAttachments[slotKey][slotKey] = attachment;
  }

  const skins = [{ name: "default", attachments: skinAttachments }];

  // ── 5. Animations ─────────────────────────────────────────────────────────
  const animations = {};

  for (const anim of project.animations) {
    const animName = sanitizeName(anim.name);
    const spineAnim = { bones: {}, slots: {} };

    // Group tracks by node
    const tracksByNode = {};
    for (const track of anim.tracks) {
      if (!tracksByNode[track.nodeId]) tracksByNode[track.nodeId] = [];
      tracksByNode[track.nodeId].push(track);
    }

    for (const [nodeId, nodeTracks] of Object.entries(tracksByNode)) {
      const node = nodes.find(n => n.id === nodeId);
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
            if (!boneEntry.translate) boneEntry.translate = [];
            for (const kf of track.keyframes) {
              const time = kf.time / 1000;
              let entry = boneEntry.translate.find(e => Math.abs(e.time - time) < 0.001);
              if (!entry) { entry = { time, x: 0, y: 0 }; boneEntry.translate.push(entry); }
              const setup = node.transform[track.property] ?? 0;
              const delta = kf.value - setup;
              if (track.property === 'x') entry.x = delta;
              else entry.y = -delta;
              applySpineCurve(entry, kf);
            }
          } else if (track.property === 'rotation') {
            if (!boneEntry.rotate) boneEntry.rotate = [];
            for (const kf of track.keyframes) {
              const setup = node.transform.rotation ?? 0;
              const entry = { time: kf.time / 1000, value: -(kf.value - setup) };
              applySpineCurve(entry, kf);
              boneEntry.rotate.push(entry);
            }
          } else if (track.property === 'scaleX' || track.property === 'scaleY') {
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

        // Sort timelines
        boneEntry.translate?.sort((a, b) => a.time - b.time);
        boneEntry.rotate?.sort((a, b) => a.time - b.time);
        boneEntry.scale?.sort((a, b) => a.time - b.time);

      } else {
        // 部件已被图集跳过时，其插槽不存在，需同步跳过插槽动画，
        // 否则 Spine 运行时会因引用未知插槽而报错
        if (!isPartAvailable(node)) continue;

        // Slot animations (opacity → rgba)
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

function sanitizeName(name) {
  const s = (name ?? 'item')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s === 'root' ? 'rig_root' : s;
}

function applySpineCurve(entry, kf) {
  if (kf.easing === 'linear') return; 
  if (kf.easing === 'stepped') {
    entry.curve = 'stepped';
  } else if (Array.isArray(kf.easing) && kf.easing.length === 4) {
    entry.curve = kf.easing;
  } else if (kf.easing === 'ease-in') {
    entry.curve = [0.42, 0, 1, 1];
  } else if (kf.easing === 'ease-out') {
    entry.curve = [0, 0, 0.58, 1];
  } else {
    // Default or 'ease-both' / 'ease' -> Ease Both
    entry.curve = [0.42, 0, 0.58, 1];
  }
}



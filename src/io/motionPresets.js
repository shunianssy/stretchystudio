/**
 * motionPresets.js — 动作预设生成库
 *
 * 为角色模型生成常见的动作剪辑（Animation），供动画面板「预设动作」菜单一键添加。
 *
 * 数据约定（详见 renderer/animationEngine.js 顶部注释）：
 *   Animation = {
 *     id, name, duration(ms), fps,
 *     tracks: [{ nodeId, property, keyframes: [{ time(ms), value, easing }] }],
 *   }
 *
 * 设计原则：
 *   1. 仅驱动骨骼组节点（type==='group' && boneRole），不直接修改任何图层数据；
 *   2. 关键帧值 = 骨骼静止值 + 动作偏移量，不会破坏用户摆好的基准姿势；
 *   3. 骨骼缺失时自动降级：分臂→合并臂（bothArms）、分腿→合并腿（bothLegs），
 *      降级后摆幅自动收窄（默认 ×0.6），避免动作过猛；
 *   4. 躺下/倒下类动作绕 root 关节整体放倒，并基于角色真实包围盒做几何计算，
 *      保证过程与末帧身体底部始终贴地，不会出现「脚朝天 / 腰部折断」；
 *   5. 循环类动作（待机/走路）首末关键帧数值完全一致，配合 loopKeyframes 无缝循环。
 *
 * 用法：
 *   import { buildPresetAnimation, buildAllPresetAnimations, MOTION_PRESETS } from '@/io/motionPresets';
 *   const anim = buildPresetAnimation(project.nodes, 'walk', { existingNames: [...] });
 */

import { computeWorldMatrices } from '../renderer/transforms.js';

/** 所有预设统一使用的帧率 */
const FPS = 24;

/** 合并骨骼降级时的默认摆幅缩放 */
const MERGED_SCALE = 0.6;

/** 生成节点 ID（与 projectStore.uid 保持一致的风格） */
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/* ─────────────────────────── 骨骼 / 包围盒收集 ─────────────────────────── */

/**
 * 收集项目中的骨骼组节点。
 * @param {Array} nodes project.nodes
 * @returns {Map<string, Object>} boneRole → 节点
 */
function collectBones(nodes) {
  const bones = new Map();
  for (const n of nodes) {
    if (n.type === 'group' && n.boneRole) bones.set(n.boneRole, n);
  }
  return bones;
}

/**
 * 计算骨骼关节（pivot）的世界坐标。
 * @param {Object} node            骨骼组节点
 * @param {Map}    worldMatrices   computeWorldMatrices 的结果
 * @returns {{x:number,y:number}}
 */
function boneWorldPivot(node, worldMatrices) {
  const px = node.transform?.pivotX ?? 0;
  const py = node.transform?.pivotY ?? 0;
  const m = worldMatrices.get(node.id);
  return m
    ? { x: m[0] * px + m[3] * py + m[6], y: m[1] * px + m[4] * py + m[7] }
    : { x: px, y: py };
}

/**
 * 计算当前姿态下角色的世界包围盒（所有图层 imageBounds 的并集）。
 * 若没有任何图层包围盒，退化为骨骼关节点包围盒；仍无数据时返回 null。
 *
 * @param {Array} nodes          project.nodes
 * @param {Map}   worldMatrices  世界矩阵表
 * @returns {{minX,minY,maxX,maxY,width,height}|null}
 */
function collectCharacterBounds(nodes, worldMatrices) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const n of nodes) {
    if (n.type !== 'part' || !n.imageBounds) continue;
    const m = worldMatrices.get(n.id);
    const b = n.imageBounds;
    const corners = [
      [b.minX, b.minY], [b.maxX, b.minY],
      [b.minX, b.maxY], [b.maxX, b.maxY],
    ];
    for (const [x, y] of corners) {
      const wx = m ? m[0] * x + m[3] * y + m[6] : x;
      const wy = m ? m[1] * x + m[4] * y + m[7] : y;
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
    }
  }

  // 退化：用骨骼关节位置估算
  if (!Number.isFinite(minX)) {
    for (const n of nodes) {
      if (n.type !== 'group' || !n.boneRole) continue;
      const p = boneWorldPivot(n, worldMatrices);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * 绕 pivot 旋转 angleDeg 后，计算让包围盒「水平居中 + 底部贴地」所需的世界位移。
 *
 * 与 transforms.js 的矩阵约定一致（屏幕坐标系 y 向下，正角度视觉上为顺时针）：
 *   x' = x·cosθ − y·sinθ
 *   y' = x·sinθ + y·cosθ
 *
 * @param {{minX,minY,maxX,maxY}} bounds  旋转前的世界包围盒
 * @param {{x:number,y:number}}   pivot   旋转中心（root 关节世界坐标）
 * @param {number}                angleDeg 旋转角度（度）
 * @returns {{x:number,y:number}} 需要施加在 root 上的平移量
 */
function rotationGroundShift(bounds, pivot, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY],
  ]) {
    const dx = x - pivot.x, dy = y - pivot.y;
    const rx = pivot.x + dx * cos - dy * sin;
    const ry = pivot.y + dx * sin + dy * cos;
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
  }

  return {
    // 水平居中：旋转后的包围盒中心对齐旋转前的中心
    x: (bounds.minX + bounds.maxX) / 2 - (minX + maxX) / 2,
    // 贴地：旋转后的底边对齐旋转前的底边
    y: bounds.maxY - maxY,
  };
}

/* ─────────────────────────── 生成上下文与轨道工具 ─────────────────────────── */

/**
 * 创建动作生成上下文（一次性收集骨骼、包围盒、root 关节，供所有预设共享）。
 * @param {Array} nodes project.nodes
 * @returns {Object|null} ctx；nodes 无有效数据时返回 null
 */
function createContext(nodes) {
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const worldMatrices = computeWorldMatrices(nodeList);
  const bones = collectBones(nodeList);
  const bounds = collectCharacterBounds(nodeList, worldMatrices);

  if (bones.size === 0 && !bounds) return null;

  const rootNode = bones.get('root');
  return {
    bones,
    bounds,
    rootPivot: rootNode ? boneWorldPivot(rootNode, worldMatrices) : null,
    /** 高度基准（用于相对幅度），缺失时给出保守默认值 */
    H: bounds?.height ?? 800,
    /** 宽度基准 */
    W: bounds?.width ?? 600,
  };
}

/**
 * 在指定骨骼节点上写入一条属性轨道（值 = 静止值 + 偏移 × scale）。
 * 同一节点同一属性只会保留第一条轨道（防止重复轨道导致数值互相覆盖）。
 *
 * @param {Array}  tracks   轨道输出列表
 * @param {Object} node     目标骨骼节点
 * @param {string} property 'x'|'y'|'rotation'|'scaleX'|'scaleY'
 * @param {Array<[number, number, string?]>} keys [时间ms, 偏移量, 缓动?]
 * @param {number} [scale=1] 偏移缩放
 * @returns {Object|null} 写入的轨道
 */
function addTrackOn(tracks, node, property, keys, scale = 1) {
  if (!node) return null;
  if (tracks.some(t => t.nodeId === node.id && t.property === property)) return null;

  const rest = node.transform?.[property]
    ?? ((property === 'scaleX' || property === 'scaleY') ? 1 : 0);

  const keyframes = keys
    .map(([time, offset, easing]) => ({
      time,
      value: rest + offset * scale,
      easing: easing ?? 'ease-both',
    }))
    .sort((a, b) => a.time - b.time);

  const track = { nodeId: node.id, property, keyframes };
  tracks.push(track);
  return track;
}

/**
 * 在指定角色的骨骼上写轨道；骨骼不存在时自动跳过。
 * @param {string} role 骨骼角色名，如 'torso'
 */
function addBoneTrack(tracks, ctx, role, property, keys, scale = 1) {
  return addTrackOn(tracks, ctx.bones.get(role), property, keys, scale);
}

/**
 * 肢体轨道：优先使用分体骨骼；缺失时降级到合并骨骼并收窄摆幅。
 *
 * @param {string} primary        主要骨骼角色名，如 'rightArm'
 * @param {string} mergedFallback 合并版骨骼角色名，如 'bothArms'
 */
function addLimbTrack(tracks, ctx, primary, mergedFallback, property, keys) {
  const primaryNode = ctx.bones.get(primary);
  if (primaryNode) return addTrackOn(tracks, primaryNode, property, keys, 1);
  const mergedNode = ctx.bones.get(mergedFallback);
  if (mergedNode) return addTrackOn(tracks, mergedNode, property, keys, MERGED_SCALE);
  return null;
}

/** 判断成对骨骼是否都存在（用于左右反相摆动的动作） */
function hasBone(ctx, role) {
  return ctx.bones.has(role);
}

/**
 * 双腿摆动：分腿时左右腿反相；未分腿时降级为整体小幅摆动。
 * @param {Array} leftKeys  左腿关键帧
 * @param {Array} rightKeys 右腿关键帧
 * @param {Array} mergedKeys 合并腿关键帧（幅度已按合并场景设计）
 */
function addLegSwing(tracks, ctx, leftKeys, rightKeys, mergedKeys) {
  if (hasBone(ctx, 'leftLeg') && hasBone(ctx, 'rightLeg')) {
    addBoneTrack(tracks, ctx, 'leftLeg', 'rotation', leftKeys);
    addBoneTrack(tracks, ctx, 'rightLeg', 'rotation', rightKeys);
  } else {
    addLimbTrack(tracks, ctx, 'leftLeg', 'bothLegs', 'rotation', mergedKeys);
  }
}

/**
 * 双臂摆动：分臂时左右臂反相；未分臂时降级为整体小幅摆动。
 */
function addArmSwing(tracks, ctx, leftKeys, rightKeys, mergedKeys) {
  if (hasBone(ctx, 'leftArm') && hasBone(ctx, 'rightArm')) {
    addBoneTrack(tracks, ctx, 'leftArm', 'rotation', leftKeys);
    addBoneTrack(tracks, ctx, 'rightArm', 'rotation', rightKeys);
  } else {
    addLimbTrack(tracks, ctx, 'leftArm', 'bothArms', 'rotation', mergedKeys);
  }
}

/* ─────────────────────────── 各动作生成器 ─────────────────────────── */

/**
 * 待机：呼吸起伏 + 头部与手臂的轻微晃动（循环）。
 */
function buildIdle(ctx, tracks) {
  const H = ctx.H;
  addBoneTrack(tracks, ctx, 'torso', 'y', [
    [0, 0], [1200, -H * 0.010], [2400, 0],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'rotation', [
    [0, 0], [1200, 0.4], [2400, 0],
  ]);
  addBoneTrack(tracks, ctx, 'head', 'rotation', [
    [0, 0], [800, -0.8], [1600, 0.5], [2400, 0],
  ]);
  addArmSwing(tracks, ctx,
    [[0, 0], [1200, -1.2], [2400, 0]],
    [[0, 0], [1200, 1.2], [2400, 0]],
    [[0, 0], [1200, -1.0], [2400, 0]],
  );
}

/**
 * 休闲待机：重心偏移 + 缓慢左右张望，比待机更松弛（循环）。
 */
function buildCasualIdle(ctx, tracks) {
  const H = ctx.H;
  const W = ctx.W;
  addBoneTrack(tracks, ctx, 'root', 'x', [
    [0, 0], [1600, W * 0.012], [3200, 0],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'rotation', [
    [0, 0], [1600, -1.3], [3200, 0],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'y', [
    [0, 0], [1600, -H * 0.008], [3200, 0],
  ]);
  addBoneTrack(tracks, ctx, 'head', 'rotation', [
    [0, -1.0], [1100, 1.6], [2200, -0.6], [3200, -1.0],
  ]);
  addArmSwing(tracks, ctx,
    [[0, 0], [1600, -1.6], [3200, 0]],
    [[0, 0], [1600, 1.2], [3200, 0]],
    [[0, 0], [1600, -1.4], [3200, 0]],
  );
}

/**
 * 走路：双腿交替摆动 + 手臂反相 + 身体每步起伏（循环，1 秒一步）。
 */
function buildWalk(ctx, tracks) {
  const H = ctx.H;
  const legA = 14;   // 分腿摆幅（度）
  const armA = 9;    // 手臂摆幅（度）

  addLegSwing(tracks, ctx,
    [[0, -legA], [250, 0], [500, legA], [750, 0], [1000, -legA]],
    [[0, legA], [250, 0], [500, -legA], [750, 0], [1000, legA]],
    [[0, -legA * 0.4], [500, legA * 0.4], [1000, -legA * 0.4]],
  );

  // 膝盖轻微屈伸（相位滞后于大腿摆动）
  if (hasBone(ctx, 'leftKnee')) {
    addBoneTrack(tracks, ctx, 'leftKnee', 'rotation',
      [[0, 0], [250, 7], [500, 0], [750, 5], [1000, 0]]);
  }
  if (hasBone(ctx, 'rightKnee')) {
    addBoneTrack(tracks, ctx, 'rightKnee', 'rotation',
      [[0, 0], [250, 5], [500, 0], [750, 7], [1000, 0]]);
  }

  addArmSwing(tracks, ctx,
    [[0, armA], [250, 0], [500, -armA], [750, 0], [1000, armA]],
    [[0, -armA], [250, 0], [500, armA], [750, 0], [1000, -armA]],
    [[0, armA * 0.5], [500, -armA * 0.5], [1000, armA * 0.5]],
  );

  // 每步一次身体起伏（抬脚时略高）+ 躯干左右轻摆、头部反向补偿
  addBoneTrack(tracks, ctx, 'root', 'y', [
    [0, 0], [250, -H * 0.012], [500, 0], [750, -H * 0.012], [1000, 0],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'rotation', [
    [0, 1.5], [250, 0], [500, -1.5], [750, 0], [1000, 1.5],
  ]);
  addBoneTrack(tracks, ctx, 'head', 'rotation', [
    [0, -1.0], [500, 1.0], [1000, -1.0],
  ]);
}

/**
 * 计算「整体放倒」类动作的分段关键帧：
 * 旋转角由 angles 列表给出，x/y 位移按每个角度对应的贴地位移逐帧计算，
 * 从而保证放倒过程中身体底部始终贴地。
 *
 * @param {{bounds, rootPivot}} ctx
 * @param {Array<[number, number, string?]>} angles [时间ms, 角度, 缓动?]
 * @returns {{rotKeys, xKeys, yKeys}}
 */
function buildGroundFallKeys(ctx, angles) {
  const shiftAt = (deg) => (ctx.bounds && ctx.rootPivot)
    ? rotationGroundShift(ctx.bounds, ctx.rootPivot, deg)
    : { x: 0, y: 0 };

  const rotKeys = angles.map(([t, deg, easing]) => [t, deg, easing]);
  const xKeys = angles.map(([t, deg]) => [t, shiftAt(deg).x, 'ease-both']);
  const yKeys = angles.map(([t, deg]) => [t, shiftAt(deg).y, 'ease-both']);
  return { rotKeys, xKeys, yKeys };
}

/**
 * 躺下：整体顺时针放倒约 88°（头向屏幕右侧），末帧平躺贴地。
 * 绕 root 关节旋转，腿脚与躯干同步放倒，不会腰部折断。
 */
function buildLieDown(ctx, tracks) {
  // 0 帧起始 → 反向蓄力 → 分段放倒 → 轻微过冲 → 稳定平躺
  const angles = [
    [0,    0,   'ease-both'],
    [180,  -5,  'ease-out'],
    [520,  36,  'ease-both'],
    [900,  74,  'ease-both'],
    [1120, 92,  'ease-out'],
    [1300, 88,  'ease-both'],
  ];
  const { rotKeys, xKeys, yKeys } = buildGroundFallKeys(ctx, angles);
  addBoneTrack(tracks, ctx, 'root', 'rotation', rotKeys);
  addBoneTrack(tracks, ctx, 'root', 'x', xKeys);
  addBoneTrack(tracks, ctx, 'root', 'y', yKeys);
}

/**
 * 倒下：整体逆时针快速倒地约 90°（头向屏幕左侧），比躺下更急促。
 */
function buildFallDown(ctx, tracks) {
  const angles = [
    [0,    0,   'ease-both'],
    [100,  -8,  'ease-out'],
    [380,  -46, 'ease-both'],
    [650,  -86, 'ease-out'],
    [780,  -95, 'ease-out'],
    [900,  -90, 'ease-both'],
  ];
  const { rotKeys, xKeys, yKeys } = buildGroundFallKeys(ctx, angles);
  addBoneTrack(tracks, ctx, 'root', 'rotation', rotKeys);
  addBoneTrack(tracks, ctx, 'root', 'x', xKeys);
  addBoneTrack(tracks, ctx, 'root', 'y', yKeys);
}

/**
 * 拔剑：右手从下探蓄力到向斜上划出，躯干微转配合。
 */
function buildDrawSword(ctx, tracks) {
  addLimbTrack(tracks, ctx, 'rightArm', 'bothArms', 'rotation', [
    [0, 0], [220, 7, 'ease-out'], [520, -52], [850, -46],
  ]);
  addLimbTrack(tracks, ctx, 'rightElbow', 'bothArms', 'rotation', [
    [0, 0], [220, 10], [520, -28], [850, -22],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'rotation', [
    [0, 0], [220, 2], [520, -4], [850, -3],
  ]);
  addBoneTrack(tracks, ctx, 'head', 'rotation', [
    [0, 0], [520, -3], [850, -3.5],
  ]);
}

/**
 * 挥剑：右臂举起蓄力后快速下挥，躯干扭转、重心下压。
 */
function buildSwingSword(ctx, tracks) {
  addLimbTrack(tracks, ctx, 'rightArm', 'bothArms', 'rotation', [
    [0, 18, 'ease-out'], [160, 26], [420, -62, 'ease-out'], [700, -56],
  ]);
  addLimbTrack(tracks, ctx, 'rightElbow', 'bothArms', 'rotation', [
    [0, -8], [160, -14], [420, -4], [700, -7],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'rotation', [
    [0, -3], [420, 7], [700, 6],
  ]);
  addBoneTrack(tracks, ctx, 'head', 'rotation', [
    [0, -2], [420, 4], [700, 3],
  ]);
  addBoneTrack(tracks, ctx, 'root', 'y', [
    [0, 0], [420, ctx.H * 0.014], [700, ctx.H * 0.012],
  ]);
}

/**
 * 开枪：右臂快速抬平，伴随后坐回弹与身体轻微后推。
 */
function buildShootGun(ctx, tracks) {
  addLimbTrack(tracks, ctx, 'rightArm', 'bothArms', 'rotation', [
    [0, 0], [130, -56, 'ease-out'], [180, -48], [290, -58], [380, -57], [500, -57],
  ]);
  addLimbTrack(tracks, ctx, 'rightElbow', 'bothArms', 'rotation', [
    [0, 0], [130, -15], [500, -13],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'rotation', [
    [0, 0], [130, -1.5], [190, -0.6], [500, -1],
  ]);
  addBoneTrack(tracks, ctx, 'root', 'x', [
    [0, 0], [180, -ctx.W * 0.008, 'ease-out'], [320, 0], [500, 0],
  ]);
  addBoneTrack(tracks, ctx, 'head', 'rotation', [
    [0, 0], [130, -2], [500, -2],
  ]);
}

/**
 * 挥动法杖：右臂高举后两段挥动，头部微仰、身体轻微上提。
 */
function buildCastSpell(ctx, tracks) {
  addLimbTrack(tracks, ctx, 'rightArm', 'bothArms', 'rotation', [
    [0, 0], [280, -32], [520, -56], [720, -46], [950, -58], [1200, -54],
  ]);
  addLimbTrack(tracks, ctx, 'rightElbow', 'bothArms', 'rotation', [
    [0, 0], [280, -14], [520, -22], [720, -12], [950, -23], [1200, -20],
  ]);
  addBoneTrack(tracks, ctx, 'head', 'rotation', [
    [0, 0], [520, -4], [1200, -3],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'rotation', [
    [0, 0], [520, -2], [1200, -1.6],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'y', [
    [0, 0], [520, -ctx.H * 0.006], [1200, -ctx.H * 0.004],
  ]);
}

/**
 * 拿盾：左臂抬起横在身前并保持，带轻微呼吸晃动。
 */
function buildHoldShield(ctx, tracks) {
  addLimbTrack(tracks, ctx, 'leftArm', 'bothArms', 'rotation', [
    [0, 0], [330, -42, 'ease-out'], [800, -39], [1500, -41],
  ]);
  addLimbTrack(tracks, ctx, 'leftElbow', 'bothArms', 'rotation', [
    [0, 0], [330, -28, 'ease-out'], [800, -26], [1500, -27],
  ]);
  addBoneTrack(tracks, ctx, 'torso', 'rotation', [
    [0, 0], [330, -1.6], [1500, -1.3],
  ]);
  addBoneTrack(tracks, ctx, 'head', 'rotation', [
    [0, 0], [330, 1.2], [1500, 1],
  ]);
}

/* ─────────────────────────── 预设清单与对外 API ─────────────────────────── */

/**
 * 动作预设清单。
 * id      — 稳定标识（供代码引用）
 * name    — 动画名（英文数据名，显示层经 labels.js 本地化）
 * duration— 时长（毫秒）
 * loop    — 建议的循环播放开关
 */
export const MOTION_PRESETS = [
  { id: 'idle',        name: 'Idle',        duration: 2400, loop: true,  build: buildIdle },
  { id: 'casual-idle', name: 'Casual Idle', duration: 3200, loop: true,  build: buildCasualIdle },
  { id: 'walk',        name: 'Walk',        duration: 1000, loop: true,  build: buildWalk },
  { id: 'lie-down',    name: 'Lie Down',    duration: 1300, loop: false, build: buildLieDown },
  { id: 'fall-down',   name: 'Fall Down',   duration: 900,  loop: false, build: buildFallDown },
  { id: 'draw-sword',  name: 'Draw Sword',  duration: 850,  loop: false, build: buildDrawSword },
  { id: 'swing-sword', name: 'Swing Sword', duration: 700,  loop: false, build: buildSwingSword },
  { id: 'shoot-gun',   name: 'Shoot Gun',   duration: 500,  loop: false, build: buildShootGun },
  { id: 'cast-spell',  name: 'Cast Spell',  duration: 1200, loop: false, build: buildCastSpell },
  { id: 'hold-shield', name: 'Hold Shield', duration: 1500, loop: false, build: buildHoldShield },
];

/**
 * 按名字去重：已存在同名动画时追加序号（如 "Walk 2"）。
 * @param {string}   base     目标名称
 * @param {string[]} existing 现有动画名列表
 * @returns {string}
 */
function uniqueName(base, existing) {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

/**
 * 基于已建好的上下文生成单个预设动画。
 * @param {Object} ctx
 * @param {Object} preset
 * @param {string[]} existingNames
 * @returns {Object|null}
 */
function buildFromContext(ctx, preset, existingNames) {
  const tracks = [];
  try {
    preset.build(ctx, tracks);
  } catch (error) {
    // 生成失败（数据异常）时跳过该预设，不影响其他动作
    console.error(`[motionPresets] 生成「${preset.name}」失败：`, error);
    return null;
  }
  if (tracks.length === 0) return null;

  return {
    id: uid(),
    name: uniqueName(preset.name, existingNames),
    duration: preset.duration,
    fps: FPS,
    tracks,
    audioTracks: [],
  };
}

/**
 * 生成单个预设动画。
 *
 * @param {Array}  nodes        project.nodes
 * @param {string} presetId     MOTION_PRESETS[].id
 * @param {{existingNames?: string[]}} [opts]
 * @returns {Object|null} 可直接写入 project.animations 的动画对象；无法生成时返回 null
 */
export function buildPresetAnimation(nodes, presetId, { existingNames = [] } = {}) {
  const preset = MOTION_PRESETS.find(p => p.id === presetId);
  if (!preset) return null;

  const ctx = createContext(nodes);
  if (!ctx) return null;

  return buildFromContext(ctx, preset, existingNames);
}

/**
 * 一键生成全部预设动画（共享一次上下文计算，避免重复遍历）。
 *
 * @param {Array}  nodes  project.nodes
 * @param {{existingNames?: string[]}} [opts]
 * @returns {Object[]} 动画对象列表（顺序与 MOTION_PRESETS 一致，无法生成的项自动跳过）
 */
export function buildAllPresetAnimations(nodes, { existingNames = [] } = {}) {
  const ctx = createContext(nodes);
  if (!ctx) return [];

  const names = [...existingNames];
  const results = [];
  for (const preset of MOTION_PRESETS) {
    const anim = buildFromContext(ctx, preset, names);
    if (anim) {
      names.push(anim.name);
      results.push(anim);
    }
  }
  return results;
}
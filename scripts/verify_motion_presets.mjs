/**
 * 动作预设生成校验脚本
 *
 * 作用：
 *   1. 用模拟骨骼数据调用 motionPresets，校验每个预设的轨道结构
 *      （非空、时间有序、数值有限、无重复轨道、循环动作首末闭环）；
 *   2. 校验「躺下 / 倒下」的几何正确性：放倒全程与末帧身体底部贴地，
 *      不会出现「脚朝天 / 腰部折断」；
 *   3. 校验合并骨骼（bothArms/bothLegs）与空数据场景下的降级行为。
 *
 * 用法：node scripts/verify_motion_presets.mjs
 * 退出码：0 = 全部通过；1 = 存在失败项（可用于 CI / 提交前检查）
 */

import {
  MOTION_PRESETS,
  buildPresetAnimation,
  buildAllPresetAnimations,
} from '../src/io/motionPresets.js';
import { makeLocalMatrix } from '../src/renderer/transforms.js';

/* ─────────────────────────── 模拟数据构造 ─────────────────────────── */

/**
 * 构造一个「分体骨骼」模拟项目：
 * 角色包围盒 (300,150)-(700,1050)，骨盆在 (500,700)。
 * @returns {Object[]} project.nodes
 */
function buildSplitModel() {
  /** 骨骼组节点工厂：pivot 为相对父节点的局部坐标 */
  const bone = (id, name, parent, pivotX, pivotY) => ({
    id, type: 'group', name, parent, boneRole: name,
    opacity: 1, visible: true,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX, pivotY },
  });

  return [
    bone('b-root',    'root',      null,      500, 700),
    bone('b-torso',   'torso',     'b-root',  0, -140),
    bone('b-neck',    'neck',      'b-torso', 0, -160),
    bone('b-head',    'head',      'b-neck',  0, -80),
    bone('b-larm',    'leftArm',   'b-torso', -80, -140),
    bone('b-rarm',    'rightArm',  'b-torso', 80, -140),
    bone('b-lelbow',  'leftElbow', 'b-larm',  -20, 140),
    bone('b-relbow',  'rightElbow','b-rarm',  20, 140),
    bone('b-lleg',    'leftLeg',   'b-root',  -35, 20),
    bone('b-rleg',    'rightLeg',  'b-root',  35, 20),
    bone('b-lknee',   'leftKnee',  'b-lleg',  0, 160),
    bone('b-rknee',   'rightKnee', 'b-rleg',  0, 160),
    {
      id: 'p-body', type: 'part', name: 'topwear', parent: 'b-torso',
      draw_order: 0, opacity: 1, visible: true,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 600 },
      imageBounds: { minX: 300, minY: 150, maxX: 700, maxY: 1050 },
    },
  ];
}

/**
 * 构造一个「合并骨骼」模拟项目：没有分臂分腿，仅有 bothArms / bothLegs。
 */
function buildMergedModel() {
  const nodes = buildSplitModel().filter(
    n => !['leftArm', 'rightArm', 'leftElbow', 'rightElbow',
          'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee'].includes(n.boneRole),
  );
  const bone = (id, name, parent, pivotX, pivotY) => ({
    id, type: 'group', name, parent, boneRole: name,
    opacity: 1, visible: true,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX, pivotY },
  });
  nodes.push(bone('b-arms', 'bothArms', 'b-torso', 0, -140));
  nodes.push(bone('b-legs', 'bothLegs', 'b-root', 0, 20));
  return nodes;
}

/* ─────────────────────────── 通用断言工具 ─────────────────────────── */

let passed = 0;
let failed = 0;

/**
 * 断言辅助：条件为真则记录通过，否则记录失败并打印原因。
 * @param {boolean} cond   断言条件
 * @param {string}  label  用例描述
 * @param {string}  [detail] 失败时的补充信息
 */
function check(cond, label, detail = '') {
  if (cond) {
    passed += 1;
    return true;
  }
  failed += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

/**
 * 对一条轨道应用「末帧/指定时间」的变换，返回该时间点的覆盖值。
 * 直接取最近的关键帧即可（校验只关注关键帧时刻的几何状态）。
 */
function keyframeAt(track, time) {
  const kf = track.keyframes.find(k => k.time === time);
  return kf ? kf.value : undefined;
}

/**
 * 计算某个时间点、root 变换（旋转 + 平移）作用后的角色包围盒。
 * @param {{minX,minY,maxX,maxY}} bounds 旋转前包围盒
 * @param {{x:number,y:number}}   pivot  旋转中心（root 关节）
 * @param {number} rot   旋转角度（度）
 * @param {number} tx    平移 x
 * @param {number} ty    平移 y
 */
function transformBounds(bounds, pivot, rot, tx, ty) {
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY],
  ]) {
    const dx = x - pivot.x, dy = y - pivot.y;
    const rx = pivot.x + dx * cos - dy * sin + tx;
    const ry = pivot.y + dx * sin + dy * cos + ty;
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
  }
  return { minX, minY, maxX, maxY };
}

/* ─────────────────────────── 校验流程 ─────────────────────────── */

const MODEL_BOUNDS = { minX: 300, minY: 150, maxX: 700, maxY: 1050 };
const ROOT_PIVOT  = { x: 500, y: 700 };

/** 校验单个预设的结构合法性 */
function verifyStructure(anim, preset) {
  const label = `[${preset.id}]`;
  if (!check(!!anim, `${label} 能生成动画`)) return;

  check(anim.duration === preset.duration, `${label} 时长与定义一致`);
  check(anim.fps === 24, `${label} 帧率为 24`);
  check(anim.tracks.length > 0, `${label} 轨道非空`);

  const seen = new Set();
  let structureOk = true;

  for (const track of anim.tracks) {
    const key = `${track.nodeId}:${track.property}`;
    if (!check(!seen.has(key), `${label} 无重复轨道 ${key}`)) structureOk = false;
    seen.add(key);

    const kfs = track.keyframes;
    if (!check(kfs.length >= 2, `${label} ${key} 关键帧数量 >= 2`)) { structureOk = false; continue; }

    for (let i = 0; i < kfs.length; i += 1) {
      if (!check(Number.isFinite(kfs[i].value),
        `${label} ${key} 第 ${i} 帧数值有限`, `value=${kfs[i].value}`)) structureOk = false;
      if (!check(kfs[i].time >= 0 && kfs[i].time <= anim.duration,
        `${label} ${key} 第 ${i} 帧时间在 [0, ${anim.duration}] 内`, `time=${kfs[i].time}`)) structureOk = false;
      if (i > 0 && !check(kfs[i].time > kfs[i - 1].time,
        `${label} ${key} 关键帧时间严格递增`, `t${i - 1}=${kfs[i - 1].time}, t${i}=${kfs[i].time}`)) structureOk = false;
    }
  }

  // 循环动作：首末关键帧数值必须一致才能无缝循环
  if (preset.loop && structureOk) {
    for (const track of anim.tracks) {
      const kfs = track.keyframes;
      check(
        Math.abs(kfs[0].value - kfs[kfs.length - 1].value) < 1e-6,
        `${label} ${track.nodeId}:${track.property} 首末关键帧闭环`,
        `first=${kfs[0].value}, last=${kfs[kfs.length - 1].value}`,
      );
    }
  }
}

/** 校验「放倒类」动作的贴地几何：每个关键帧时刻身体底部都应贴地 */
function verifyGroundFall(anim, preset) {
  const label = `[${preset.id}]`;
  const rootRot = anim.tracks.find(t => t.property === 'rotation');
  const rootX   = anim.tracks.find(t => t.property === 'x');
  const rootY   = anim.tracks.find(t => t.property === 'y');
  if (!check(!!rootRot && !!rootX && !!rootY, `${label} 存在 root 旋转与位移轨道`)) return;

  let allGrounded = true;
  for (const kf of rootRot.keyframes) {
    const rot = keyframeAt(rootRot, kf.time);
    const tx  = keyframeAt(rootX, kf.time);
    const ty  = keyframeAt(rootY, kf.time);
    const tb  = transformBounds(MODEL_BOUNDS, ROOT_PIVOT, rot, tx, ty);
    const gap = Math.abs(tb.maxY - MODEL_BOUNDS.maxY); // 底边与地面线的偏差
    if (!check(gap < 1.5, `${label} t=${kf.time}ms 底部贴地`, `偏差 ${gap.toFixed(2)}px`)) allGrounded = false;
  }

  // 末帧已放倒：包围盒高 ≈ 原宽度（身体横过来），且头不再朝上
  const last = rootRot.keyframes[rootRot.keyframes.length - 1];
  const rot  = last.value;
  const tx   = keyframeAt(rootX, last.time);
  const ty   = keyframeAt(rootY, last.time);
  const tb   = transformBounds(MODEL_BOUNDS, ROOT_PIVOT, rot, tx, ty);
  const restW = MODEL_BOUNDS.maxX - MODEL_BOUNDS.minX;
  const restH = MODEL_BOUNDS.maxY - MODEL_BOUNDS.minY;
  const rotH  = tb.maxY - tb.minY;
  const rotW  = tb.maxX - tb.minX;

  check(Math.abs(rot) > 80, `${label} 末帧已放倒（|角| > 80°）`, `angle=${rot}`);
  check(Math.abs(rotH - restW) / restW < 0.3,
    `${label} 末帧呈横躺（高度≈原宽度）`, `rotH=${rotH.toFixed(0)}, restW=${restW}`);
  check(rotW <= restH * 1.05 + 2,
    `${label} 末帧不超出原站立范围过多`, `rotW=${rotW.toFixed(0)}, restH=${restH}`);
  check(allGrounded, `${label} 全程贴地`);
}

function main() {
  console.log('=== 动作预设生成校验 ===\n');

  const splitNodes = buildSplitModel();
  const splitNames = [];

  // 1. 全量生成（分体骨骼模型）
  console.log('· 分体骨骼模型：全量生成');
  const all = buildAllPresetAnimations(splitNodes);
  check(all.length === MOTION_PRESETS.length,
    `应生成 ${MOTION_PRESETS.length} 个动作`, `实际 ${all.length} 个`);

  for (const preset of MOTION_PRESETS) {
    const anim = buildPresetAnimation(splitNodes, preset.id, { existingNames: splitNames });
    verifyStructure(anim, preset);
    if (anim) splitNames.push(anim.name);
  }

  // 2. 放倒类动作的几何校验
  console.log('· 放倒类动作几何校验');
  for (const id of ['lie-down', 'fall-down']) {
    const preset = MOTION_PRESETS.find(p => p.id === id);
    const anim = buildPresetAnimation(splitNodes, id);
    if (anim) verifyGroundFall(anim, preset);
  }

  // 3. 合并骨骼模型降级
  console.log('· 合并骨骼模型：降级生成');
  const mergedNodes = buildMergedModel();
  const mergedAll = buildAllPresetAnimations(mergedNodes);
  check(mergedAll.length === MOTION_PRESETS.length,
    '合并模型也应生成全部动作', `实际 ${mergedAll.length} 个`);

  const walkMerged = mergedAll.find(a => a.name === 'Walk');
  if (check(!!walkMerged, '合并模型可生成走路动作')) {
    const legTrack = walkMerged.tracks.find(t => t.nodeId === 'b-legs' || t.nodeId === 'b-arms');
    check(!!legTrack, '合并模型走路驱动整体骨骼（bothLegs/bothArms）');
    const maxAmp = Math.max(...walkMerged.tracks.filter(t => t.property === 'rotation')
      .flatMap(t => t.keyframes.map(k => Math.abs(k.value))));
    check(maxAmp <= 16, '合并模型摆幅自动收窄（最大角 <= 16°）', `最大 ${maxAmp.toFixed(1)}°`);
  }

  // 4. 空数据 / 非法输入
  console.log('· 空数据与非法输入');
  check(buildPresetAnimation([], 'walk') === null, '空节点返回 null');
  check(buildPresetAnimation(null, 'walk') === null, 'null 节点返回 null');
  check(buildPresetAnimation(splitNodes, 'not-exist') === null, '未知预设 id 返回 null');
  check(buildAllPresetAnimations([]).length === 0, '空节点全量生成返回空数组');

  // 5. 同名去重
  console.log('· 名称去重');
  const dup = buildPresetAnimation(splitNodes, 'walk', { existingNames: ['Walk', 'Walk 2'] });
  check(dup && dup.name === 'Walk 3', '同名动画自动追加序号', `name=${dup?.name}`);

  // 6. 与渲染引擎矩阵约定一致性（防止几何公式与 transforms.js 脱节）
  console.log('· 渲染矩阵约定一致性');
  {
    const rot = 88, tx = 123.4, ty = -56.7;
    const pivot = ROOT_PIVOT;
    const m = makeLocalMatrix({
      x: tx, y: ty, rotation: rot, scaleX: 1, scaleY: 1,
      pivotX: pivot.x, pivotY: pivot.y,
    });
    const byMatrix = (x, y) => ({
      x: m[0] * x + m[3] * y + m[6],
      y: m[1] * x + m[4] * y + m[7],
    });
    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const byFormula = (x, y) => {
      const dx = x - pivot.x, dy = y - pivot.y;
      return {
        x: pivot.x + dx * cos - dy * sin + tx,
        y: pivot.y + dx * sin + dy * cos + ty,
      };
    };
    for (const [x, y] of [[300, 150], [700, 150], [300, 1050], [700, 1050]]) {
      const a = byMatrix(x, y);
      const b = byFormula(x, y);
      // 容差 0.001px：两条计算路径的浮点运算顺序不同，误差应在千分之一像素以内
      check(
        Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3,
        `点位 (${x},${y}) 两种算法一致`,
        `matrix=(${a.x.toFixed(3)},${a.y.toFixed(3)}) formula=(${b.x.toFixed(3)},${b.y.toFixed(3)})`,
      );
    }
  }

  // 结果汇总
  console.log(`\n=== 结果：通过 ${passed} 项，失败 ${failed} 项 ===`);
  if (failed > 0) process.exit(1);
}

main();
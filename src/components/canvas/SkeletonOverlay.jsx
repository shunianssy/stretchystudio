/**
 * SkeletonOverlay —— 叠加在 WebGL 画布之上的 SVG 骨架交互层。
 *
 * 一句话职责：
 *   把「骨架」用 SVG 画在画布上层，让用户能直观看到骨骼连线与关节圆点，
 *   并能直接拖动关节（改轴心）或拖动外圈旋转弧来摆姿势。
 *   之所以不用 WebGL 画骨架：SVG 的命中检测、光标样式、文字标签排版实现更简单，
 *   而且骨架元素数量很少，SVG 开销可以忽略。
 *
 * 骨架数据来源：
 *   骨架 = 带 boneRole 属性的 group 节点；关节位置就存在 group 节点的
 *   transform.pivotX / pivotY 上（复用已有字段，不引入新数据结构）。
 *
 * 本文件默认导出的组件及 props：
 *   <SkeletonOverlay view editorMode showSkeleton skeletonEditMode />
 *   - view            : { zoom, panX, panY } 画布视图变换
 *   - editorMode      : 'staging' | 'animation'（其他模式直接不渲染）
 *   - showSkeleton    : 是否显示骨架
 *   - skeletonEditMode: 是否处于「骨架编辑模式」（可拖关节改轴心）
 *
 * 典型用法（由 CanvasViewport 挂载，位于画布 DOM 层内）：
 *   <SkeletonOverlay
 *     view={editorState.view}
 *     editorMode={editorState.editorMode}
 *     showSkeleton={editorState.showSkeleton}
 *     skeletonEditMode={editorState.skeletonEditMode}
 *   />
 *
 * 两种坐标空间（切勿混淆）：
 *   image-space（图像像素，存进 project 的数据）  →  canvas CSS px（屏幕像素，SVG 使用）
 *     cssX = px * zoom + panX
 *     px   = (cssX - panX) / zoom
 *
 * 三种拖动类型（记录在 dragRef.current.type）：
 *   'joint'    : 骨架编辑模式下拖动关节 → 改 pivotX/pivotY
 *   'rotate'   : 拖动关节外圈的旋转弧 → 改 rotation（并联动四肢顶点蒙皮）
 *   'trackpad' : 拖动眼睛的 2D 虹膜偏移滑杆
 */

import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { useAnimationStore } from '@/store/animationStore';
import { SKELETON_CONNECTIONS } from '@/io/armatureOrganizer';
import { computeWorldMatrices, mat3Identity, mat3Inverse } from '@/renderer/transforms';
import { computePoseOverrides } from '@/renderer/animationEngine';
import { computeLimbWeights, isDegenerateJoint, suggestLimbJointPivot } from '@/mesh/limbWeights';
import { useToast } from '@/hooks/use-toast';
import { beginBatch, endBatch } from '@/store/undoHistory';
import { useTranslation } from '@/i18n';
import { labelFor } from '@/i18n/labels';

// 骨架配色：用三种状态色区分「普通 / 可拖拽 / 正在拖拽」，让用户一眼看出当前能否操作
const COLOUR_NORMAL = '#ef4444';      // 红色 —— 未进入骨架编辑模式
const COLOUR_EDIT   = '#facc15';      // 黄色 —— 编辑模式，可拖动关节
const COLOUR_DRAG   = '#22d3ee';      // 青色 —— 正在拖拽的关节
const LINE_COLOUR   = 'rgba(34,211,238,0.55)'; // 骨骼连线（半透明青色，避免遮挡画面）

// 关节圆点半径（屏幕像素）：编辑模式放大，方便点中
const JOINT_RADIUS_NORMAL = 5;
const JOINT_RADIUS_EDIT   = 8;

// ── 旋转弧手柄常量 ──
// ARC_BONE_ROLES：允许显示旋转弧的骨骼角色白名单。
// 为什么要白名单而非全部：躯干/头颈/四肢这类大骨骼是常用的旋转对象，
// 手指等细小骨骼都画弧会过于密集、互相遮挡、反而难以点中。
// 注意：此集合与 CanvasViewport / Inspector 中的角色集合保持一致，
// 新增肢体关节时需要同步这三处（见 docs/elbow_implementation.md）。
const ARC_BONE_ROLES = new Set(['torso', 'neck', 'head', 'leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'bothArms', 'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'bothLegs']);
const ARC_RADIUS = 28;      // 弧半径（屏幕像素）：故意不随 zoom 缩放，保证任何缩放下都好点中
const ARC_SWEEP_DEG = 270;  // 弧覆盖角度：留 90° 缺口，避开关节圆点与其他元素，减少误触
const ARC_COLOUR = 'rgba(251,191,36,0.55)';
const ARC_ACTIVE = 'rgba(251,191,36,0.95)'; // 拖拽中加深，给出即时反馈
const ARC_STROKE_W = 5;     // 弧线宽度：加粗以提高命中率

/**
 * 图像坐标 → 屏幕（SVG/CSS）坐标：先按 zoom 缩放，再叠加画布平移。
 *
 * @param {number} x,y       图像像素坐标
 * @param {number} zoom      画布缩放系数
 * @param {number} panX,panY 画布平移量（屏幕像素）
 * @returns {[number, number]} [屏幕 x, 屏幕 y]
 */
function toScreen(x, y, zoom, panX, panY) {
  return [x * zoom + panX, y * zoom + panY];
}


/**
 * 屏幕（SVG/CSS）坐标 → 图像坐标：toScreen 的逆运算（先减平移，再除以缩放）。
 * 拖动关节时需要用它把鼠标的屏幕位置换算回可写入 project 的图像坐标。
 *
 * @param {number} cssX,cssY 屏幕像素坐标
 * @param {number} zoom      画布缩放系数
 * @param {number} panX,panY 画布平移量（屏幕像素）
 * @returns {[number, number]} [图像 x, 图像 y]
 */
function toImage(cssX, cssY, zoom, panX, panY) {
  return [(cssX - panX) / zoom, (cssY - panY) / zoom];
}


/**
 * 按「关节绝对旋转角」把四肢顶点从静止坐标摆到目标姿态。
 *
 * 公式：每个顶点绕关节轴心旋转 angleDeg × weight。
 *   weight = 0 → 顶点不动（跟随肩 / 髋）；weight = 1 → 整量旋转（跟随肘 / 膝）；
 *   0 < weight < 1 → 部分旋转，形成关节处的平滑过渡。
 *
 * 为什么以「静止坐标 + 绝对角度」为基准，而不是在上一帧顶点上继续叠增量：
 *   两者在数学上等价（增量累加 = 权重稳定的绝对旋转），但绝对式每次都由 restX/restY
 *   重算，任何历史上被烘焙坏的形变都会被自动抹掉 —— 用户只要按一下关节，被拧成
 *   麻花的手就会恢复原状，不需要重新导入 PSD 或重做网格。
 *
 * @param {Array<{x:number,y:number,restX?:number,restY?:number}>} restVerts 静止坐标顶点（x/y 仅作兜底）
 * @param {Array<{x:number,y:number}>} baseVerts 参考顶点：动画模式下为关键帧 / 草稿顶点，非动画模式传 null
 * @param {number[]} weights    与顶点等长的权重数组（0..1）
 * @param {number} pivotX,pivotY 关节轴心（图像坐标）
 * @param {number} angleDeg     旋转角（度，与骨骼 rotation 同向同刻度）
 * @returns {Array<{x:number,y:number}>} 摆好姿势的顶点数组
 */
function poseLimbVertices(restVerts, baseVerts, weights, pivotX, pivotY, angleDeg) {
  const angleRad = angleDeg * (Math.PI / 180);

  return restVerts.map((restVertex, index) => {
    // 参考位置：优先用调用方给的基线（关键帧 / 上一帧），否则回到静止坐标
    const base = baseVerts?.[index] ?? restVertex;
    // restX/restY 是形变重算的锚，缺省时退化成当前坐标（旧数据）
    const baseX = base?.x ?? restVertex?.restX ?? restVertex?.x ?? 0;
    const baseY = base?.y ?? restVertex?.restY ?? restVertex?.y ?? 0;

    const weight = Number(weights?.[index] ?? 0);
    // 注意：返回值必须保留 restX/restY 等原始字段 —— 这批顶点随后会被烘焙回
    // mesh.vertices，一旦丢掉静止坐标，自愈（以静止坐标重算）就永久失效了。
    if (weight === 0) return { ...restVertex, x: baseX, y: baseY }; // 不参与形变

    // 以关节为原点取偏移向量，再按「角度 × 权重」旋转
    const offsetX = baseX - pivotX;
    const offsetY = baseY - pivotY;
    const weightedAngle = angleRad * weight;
    const cosWeighted = Math.cos(weightedAngle);
    const sinWeighted = Math.sin(weightedAngle);

    return {
      ...restVertex,
      x: pivotX + offsetX * cosWeighted - offsetY * sinWeighted,
      y: pivotY + offsetX * sinWeighted + offsetY * cosWeighted,
    };
  });
}


/**
 * 生成一段圆弧的 SVG path（旋转手柄用）。
 *
 * 为什么自己拼 path：SVG 没有现成的「圆环扇形」原语，只能用 A（arc）命令手写。
 * 这里把 startDeg 当作弧的正中方向，向两侧各展开 sweepDeg/2，得到一段对称的弧形手柄。
 * large-arc-flag 用 sweepDeg > 180 判断：弧超过半圆时必须置 1，否则会被画成它的补角（缺的那段）。
 *
 * @param {number} cx,cy     圆心屏幕坐标
 * @param {number} r         半径
 * @param {number} startDeg  弧的中心方向（度；0° 指向 +x，屏幕坐标下顺时针为正）
 * @param {number} sweepDeg  弧张开的总角度（度）
 * @returns {string} SVG path 的 d 属性字符串
 */
function arcPath(cx, cy, r, startDeg, sweepDeg) {
  const half = sweepDeg / 2; // 向中心方向两侧各展开一半
  const a1 = (startDeg - half) * (Math.PI / 180);
  const a2 = (startDeg + half) * (Math.PI / 180);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * 骨架交互浮层组件。
 *
 * 元素叠放顺序（自底到顶）：旋转弧 arcs → 骨骼线 lines → 关节圆 circles → 眼睛滑杆 trackpads。
 * 把弧放最底层，是为了让关节圆盖在弧上，拖动时优先命中关节而不是弧。
 *
 * 两套「节点」概念务必分清：
 *   - nodes          : 项目里保存的原始节点
 *   - effectiveNodes : 叠加「动画播放姿态 + 用户草稿姿态」后的节点，用于渲染与命中检测，
 *                      这样播放动画或拖草稿时骨架会跟着动，与画布画面保持一致。
 */
export default function SkeletonOverlay({ view, editorMode, showSkeleton, skeletonEditMode }) {
  // ── 输入数据源：订阅项目 / 编辑器 / 动画三个 store ──
  const updateProject  = useProjectStore(s => s.updateProject);
  const nodes          = useProjectStore(s => s.project.nodes);       // 原始节点（未叠加动画）
  const animations     = useProjectStore(s => s.project.animations);

  const selection      = useEditorStore(s => s.selection);
  const setSelection   = useEditorStore(s => s.setSelection);
  const blendShapeEditMode = useEditorStore(s => s.blendShapeEditMode);
  const activeBlendShapeId = useEditorStore(s => s.activeBlendShapeId);
  // 动画 store：尽量只订阅本组件真正需要渲染的字段，减少无关更新导致的重渲染
  const animCurrentTime       = useAnimationStore(s => s.currentTime);
  const animActiveAnimationId = useAnimationStore(s => s.activeAnimationId);
  const animDraftPose         = useAnimationStore(s => s.draftPose);
  const animLoopKeyframes     = useAnimationStore(s => s.loopKeyframes);
  const animFps               = useAnimationStore(s => s.fps);
  const animEndFrame          = useAnimationStore(s => s.endFrame);
  const setDraftPose          = useAnimationStore(s => s.setDraftPose);
  const clearDraftPoseForNode = useAnimationStore(s => s.clearDraftPoseForNode);

  // 拖动状态：{ type: 'joint' | 'rotate' | 'trackpad', nodeId, ... }。
  // 放 ref 而不是 state：拖动中每帧都会更新，用 state 会触发海量重渲染。
  const dragRef  = useRef(null);
  const svgRef   = useRef(null);

  // 事件处理器读取的「最新值」快照。
  // 为什么用 ref：下面的 useCallback 处理器为了保持稳定身份不能把 view/editorMode/setDraftPose
  // 放进依赖数组，但处理器执行时又需要最新值，故用 ref 同步，避免闭包读到过期数据（stale closure）。
  const viewRef         = useRef(view);
  const editorModeRef   = useRef(editorMode);
  const setDraftPoseRef = useRef(setDraftPose);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { editorModeRef.current = editorMode; }, [editorMode]);
  useEffect(() => { setDraftPoseRef.current = setDraftPose; }, [setDraftPose]);

  const { toast } = useToast();
  const { t, lang } = useTranslation();

  // 选中肘/膝关节时，若它还没有关联网格，提示用户「先生成肢体网格」。
  // 为什么需要：肘/膝的形变依赖关联网格（mesh.jointBoneId === 关节 id）；
  // 若只绑了关节却没生成网格，拖动关节时没有任何可形变部件，用户会误以为功能坏了。
  useEffect(() => {
    if (selection.length !== 1) return; // 只在单选时判断，多选用不上这个提示

    const nodeId = selection[0];
    const node = nodes.find(n => n.id === nodeId);
    if (!node || node.type !== 'group' || !node.boneRole) return; // 不是骨骼节点，不提示

    // 只有肘/膝这四个「会驱动网格形变」的关节才需要这个提醒
    const JSKinningRoles = new Set(['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']);
    if (JSKinningRoles.has(node.boneRole)) {
      const hasDependent = nodes.some(n => n.type === 'part' && n.mesh?.jointBoneId === node.id);
      if (!hasDependent) {
        toast({
          title: t('canvas.skeleton.limbMesh.title'),
          description: t('canvas.skeleton.limbMesh.description')
        });
      }
    }
  }, [selection, nodes, toast, t]);

  // 动画能够改写的属性集合；叠加时只覆盖这些 key，其余字段保持节点原值不变。
  const ANIM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];

  /**
   * 计算「生效节点」= 原始节点 叠加（动画播放姿态 + 用户草稿姿态）。
   * 仅有动画模式才需要叠加；staging 模式直接用原始节点。
   * 若两种姿态都不存在，直接返回原数组（保持引用不变，省掉下游无谓的重算）。
   */
  const effectiveNodes = useMemo(() => {
    if (editorMode !== 'animation') return nodes; // 非动画模式无需叠加

    const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
    const endMs = (animEndFrame / animFps) * 1000; // 结束时间换算成毫秒，供循环判断使用
    const overrides  = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);
    const hasDraft   = animDraftPose.size > 0;
    if (!overrides.size && !hasDraft) return nodes; // 无任何覆盖数据，直接复用原数组

    return nodes.map(node => {
      const ov = overrides.get(node.id);
      const dr = animDraftPose.get(node.id);
      if (!ov && !dr) return node;
      const tr = { ...node.transform };
      // 覆盖优先级：草稿姿态 > 动画播放姿态 > 节点原值。
      // 草稿是用户正在拖动的实时预览，必须压过播放中的关键帧插值，否则手感会被「抢回去」。
      if (ov) for (const k of ANIM_KEYS) { if (ov[k] !== undefined) tr[k] = ov[k]; }
      if (dr) for (const k of ANIM_KEYS) { if (dr[k] !== undefined) tr[k] = dr[k]; }
      return { ...node, transform: tr, opacity: dr?.opacity ?? ov?.opacity ?? node.opacity };
    });
  }, [editorMode, nodes, animations, animActiveAnimationId, animCurrentTime, animDraftPose, animLoopKeyframes, animFps, animEndFrame]);

  // 把骨骼 group 节点按 boneRole 建索引，方便直接用角色取骨骼（如 boneNodes.leftElbow）。
  // 同一角色理论上唯一，若重复则后者覆盖前者。
  const boneNodes = React.useMemo(() => {
    const map = {};
    for (const n of effectiveNodes) {
      if (n.type === 'group' && n.boneRole) map[n.boneRole] = n;
    }
    return map;
  }, [effectiveNodes]);

  /* ── 关键帧覆盖：在指针处理器之前先算好，供拖动时取「起始姿态」基准 ── */

  const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
  const endMs = (animEndFrame / animFps) * 1000;
  const keyframeOverrides = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);

  /* ── 指针处理器：必须无条件定义，遵守 React Hooks 规则（不能放在提前 return 之后） ── */

  /**
   * 指针按下统一入口，按 dragType 分发到三条互斥分支。
   *
   * 为什么用同一个处理器而不是三个：三条拖动共用「指针捕获 + 结束收尾」逻辑
   * （见 onPointerUp），合并可避免重复绑定与收尾逻辑不一致。
   * 三条分支互斥：骨架编辑模式只允许拖关节，非编辑模式才允许拖旋转弧/滑杆，避免误触。
   *
   * @param {PointerEvent} e      指针事件
   * @param {string} nodeId       目标骨骼节点 id
   * @param {'joint'|'trackpad'|'rotate'} dragType 拖动类型，默认 'joint'
   */
  const onPointerDown = useCallback((e, nodeId, dragType = 'joint') => {
    // 段落 0：通用守卫 —— 只响应左键，让中/右键穿透给画布（如平移、右键菜单）
    if (e.button !== 0) return;

    // 阻止冒泡并捕获指针：否则会触发画布自身的框选/平移；捕获后拖出元素范围也能持续收到 move/up
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (dragType === 'joint') {
      // 段落 1：拖动关节（改轴心）—— 仅骨架编辑模式生效
      if (!skeletonEditMode) return; // 非编辑模式点关节只做选中，不做拖动
      dragRef.current = { type: 'joint', nodeId };
    } else if (dragType === 'trackpad') {
      // 段落 2：眼睛虹膜 2D 滑杆 —— 骨架编辑模式下不启用（编辑时优先调整骨架）
      if (skeletonEditMode) return;
      const svg = svgRef.current;
      if (!svg) return; // SVG 尚未挂载，无法把屏幕坐标换算成图像坐标
      const rect = svg.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      // 滑杆以「眼睛关节的世界位置」为中心，故这里用父级世界矩阵换算轴心世界坐标
      const worldMap = computeWorldMatrices(effectiveNodes);
      const node = effectiveNodes.find(n => n.id === nodeId);
      if (!node) return; // 节点不存在，放弃（可能刚被删除）
      let parentWorldMatrix = mat3Identity();
      if (node.parent && worldMap.has(node.parent)) {
         parentWorldMatrix = worldMap.get(node.parent);
      }
      const pivotWorldX = parentWorldMatrix[0] * node.transform.pivotX + parentWorldMatrix[3] * node.transform.pivotY + parentWorldMatrix[6];
      const pivotWorldY = parentWorldMatrix[1] * node.transform.pivotX + parentWorldMatrix[4] * node.transform.pivotY + parentWorldMatrix[7];
      const { zoom, panX, panY } = viewRef.current;
      const cx = pivotWorldX * zoom + panX;
      const cy = pivotWorldY * zoom + panY;
      const trackpadScreenX = cx + 0;
      const trackpadScreenY = cy - 120; // 上移到头顶上方，避免滑杆压住脸部

      // 记录滑杆中心（屏幕坐标）供 move 阶段换算偏移；同时记录是否动画模式以决定写草稿还是写项目
      dragRef.current = {
        type: 'trackpad',
        nodeId,
        tpX: trackpadScreenX,
        tpY: trackpadScreenY,
        isAnimMode: editorModeRef.current === 'animation',
      };

      setSelection([nodeId]);

      // 编辑写操作前开启撤销批处理，让整次拖动只算一步撤销
      if (editorModeRef.current === 'staging') {
        beginBatch(useProjectStore.getState().project);
      }

      // 按下瞬间就把滑杆拉到指针处，避免「必须先拖一下才响应」的粘滞感
      const dx = cssX - trackpadScreenX;
      const dy = cssY - trackpadScreenY;
      const TP_SIZE = 80;       // 滑杆边长（屏幕像素），固定不随 zoom 缩放，保证手感一致
      const half = TP_SIZE / 2; // 半边长，用于把偏移量限幅在滑杆内
      const MAX_OFFSET = 40;    // 滑杆边缘对应的最大虹膜偏移量（图像像素）
      let clampedOffsetX = dx;
      if (clampedOffsetX < -half) clampedOffsetX = -half;
      if (clampedOffsetX > half) clampedOffsetX = half;
      let clampedOffsetY = dy;
      if (clampedOffsetY < -half) clampedOffsetY = -half;
      if (clampedOffsetY > half) clampedOffsetY = half;
      const newX = (clampedOffsetX / half) * MAX_OFFSET; // 归一化到 [-1,1] 后再放大成实际偏移
      const newY = (clampedOffsetY / half) * MAX_OFFSET;

      if (editorModeRef.current === 'animation') {
         setDraftPoseRef.current(nodeId, { x: newX, y: newY });
      } else {
         updateProject((proj) => {
           const pn = proj.nodes.find(n => n.id === nodeId);
           if (!pn) return;
           // 兼容旧数据：transform 缺失时补一个完整的默认变换
           if (!pn.transform) pn.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
           pn.transform.x = newX;
           pn.transform.y = newY;
         });
      }
    } else if (dragType === 'rotate') {
      // 段落 3：拖动旋转弧（改 rotation，并联动四肢顶点蒙皮）—— 非骨架编辑模式生效
      if (skeletonEditMode) return; // 编辑模式下弧不可拖，避免与关节拖动冲突
      const svg = svgRef.current;
      if (!svg) return; // SVG 尚未挂载，无法换算坐标
      const rect = svg.getBoundingClientRect();
      const { zoom, panX, panY } = viewRef.current;

      const worldMap = computeWorldMatrices(effectiveNodes);
      const node = effectiveNodes.find(n => n.id === nodeId);
      if (!node) return; // 节点不存在，放弃（可能刚被删除）

      // 有效轴心：若下方触发了「退化关节自动修复」，会被替换成修复后的位置
      let pivotX = node.transform.pivotX;
      let pivotY = node.transform.pivotY;
      let jointRepaired = false;

      // 只有肘/膝会驱动「顶点蒙皮」；肩、髋等其它骨骼转动时不改网格
      const JSKinningRoles = new Set(['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']);
      const dependentParts = [];   // 本次拖动要实时形变的部件（含预先算好的逐顶点权重）
      const degenerateParts = [];  // 因关节退化/旧数据无法安全形变、需要提示用户的部件名

      // 段落 3.1：为肘/膝收集依赖部件，并按需自愈退化关节
      if (JSKinningRoles.has(node.boneRole)) {
        const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
        const endMs = (animEndFrame / animFps) * 1000;
        const overrides = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);
        // 父骨骼（肩 / 髋）：肢体轴向要由「父轴心 → 子关节轴心」决定
        const shoulder = effectiveNodes.find(n => n.id === node.parent);
        const shoulderX = shoulder?.transform?.pivotX ?? 0;
        const shoulderY = shoulder?.transform?.pivotY ?? 0;
        const depNodes = effectiveNodes.filter(pt => pt.type === 'part' && pt.mesh?.jointBoneId === node.id);

        // 段落 3.2：退化关节自动修复（自愈）
        // ───────────────────────────────────────────────────────────
        // 何谓退化关节：肘/膝的轴长 < 8px（几乎与肩/髋重合），此时整块部件会
        // 绕错误的轴刚性旋转，并被永久烘焙进顶点（用户看到的「左手扭曲 + 一道硬折痕」）。
        // 过去只能「跳过形变 + toast 提示用户手动调整关节」，但坏形变往往早已烘焙进网格。
        // 现在改用 suggestLimbJointPivot() 自愈：
        //   - arm：腕 = 依赖部件包围盒并集上离肩最近的点；leg：踝 = 离髋最远的 bbox 角；
        //   - 关节 = 父关节与锚点中点。
        // 注意：这里只把「轴心」挪回合理位置；顶点归零交给段落 3.3 统一处理
        // （那里每次拖动都以静止坐标重算，坏形变自动被抹掉）。
        if (depNodes.length > 0 && isDegenerateJoint(shoulderX, shoulderY, pivotX, pivotY)) {
          const kind = node.boneRole.endsWith('Elbow') ? 'arm' : 'leg'; // 由角色后缀判断肢体类型
          const fix = suggestLimbJointPivot(shoulderX, shoulderY, depNodes, kind);
          if (fix) {
            // 写入项目（必须在 beginBatch 之前 → 让「修复」本身成为独立的一步撤销，
            // 不与本次拖动混在一起，用户可单独 Ctrl+Z 撤回修复）
            updateProject((proj) => {
              const bn = proj.nodes.find(n => n.id === nodeId);
              if (bn?.transform) {
                bn.transform.pivotX = fix.x;
                bn.transform.pivotY = fix.y;
              }
            });
            pivotX = fix.x;
            pivotY = fix.y;
            jointRepaired = true;
            toast({
              title: t('canvas.skeleton.jointAutoFixed.title'),
              description: t('canvas.skeleton.jointAutoFixed.description'),
            });
            console.log(`[SkeletonOverlay] ${node.boneRole} pivot auto-repaired to (${fix.x.toFixed(0)},${fix.y.toFixed(0)})`);
          }
        }

        // 段落 3.3：逐部件建立「静止基线 restVerts + 逐顶点权重」
        // ───────────────────────────────────────────────────────────
        // 为什么基线用 restX/restY 而不是当前 x/y：
        //   关节旋转是以「权重 × 绝对角度」的方式烘焙进顶点 x/y 的。以静止坐标重算，
        //   结果与增量累加在数学上等价，但任何历史上被烘焙坏的形变都会被自动抹掉，
        //   于是用户只要点一下肘关节，被拧成麻花的手就恢复原状（无需重导 PSD / 重做网格）。
        //   这一点只在 staging（绑定）模式成立：动画模式的顶点来自关键帧，是关键帧的
        //   绝对顶点，不能拿静止坐标去重置，否则会破坏已打好的关键帧。
        const useRestBaseline = editorModeRef.current === 'staging';
        for (const pt of depNodes) {
          // 跳过形变：关节仍然退化（自动修复没推导出位置）
          if (isDegenerateJoint(shoulderX, shoulderY, pivotX, pivotY)) {
            degenerateParts.push(pt.name ?? pt.id);
            continue;
          }
          const rawVerts = pt.mesh?.vertices ?? [];
          // 静止基线：优先 restX/restY，缺失（旧数据）时退回当前坐标
          const restVerts = rawVerts.map(v => ({
            ...v,
            x: Number.isFinite(v.restX) ? v.restX : (v.x ?? 0),
            y: Number.isFinite(v.restY) ? v.restY : (v.y ?? 0),
          }));
          const hasRestCoords = restVerts.some(v => Number.isFinite(v.restX) && Number.isFinite(v.restY));
          // 关节刚被自动修复、但网格是缺少静止坐标的旧数据 → 恢复不了，别把坏形变再甩一次
          if (jointRepaired && !hasRestCoords) {
            degenerateParts.push(pt.name ?? pt.id);
            continue;
          }

          // 参考基线（增量式用）：staging 为 null（走绝对式，见上）；动画模式取草稿 / 关键帧 /
          // 基础网格，保持与旧行为一致的增量旋转。
          const baseVerts = useRestBaseline
            ? null
            : (animDraftPose.get(pt.id)?.mesh_verts
               ?? overrides?.get(pt.id)?.mesh_verts
               ?? pt.mesh.vertices);

          // 权重必须用**当前**轴心重算，不能复用 mesh 里烘焙的 boneWeights：
          // 烘焙权重是生成网格那一刻的，之后一旦拖动过肘/膝关节就会过期，
          // 导致关节两侧顶点按错误比例旋转 → 部件扭曲 + 一道硬折痕（像被切开）。
          // 同时传入 triangles：权重沿网格拓扑（测地距离）计算，弯曲肢体 / 小部件
          // 才不会因为直线投影算错一侧归属而被扯成扇形（手部扭曲的根因）。
          const weights = computeLimbWeights(
            restVerts, shoulderX, shoulderY,
            pivotX, pivotY, undefined, pt.mesh?.triangles
          );
          dependentParts.push({
            partId: pt.id,
            restVerts,                                   // 绝对式的锚：静止坐标
            baseVerts,                                   // 增量式的基线；null 表示走绝对式
            boneWeights: weights,
            imgPivotX: pivotX,
            imgPivotY: pivotY,
          });

          // staging 模式：按下立即按「骨骼当前角度」摆好姿态。这样即使用户只单击不拖动，
          // 也能把历史坏形变清零（自愈），并给出即时视觉反馈。
          if (useRestBaseline) {
            setDraftPoseRef.current(pt.id, {
              mesh_verts: poseLimbVertices(
                restVerts, null, weights, pivotX, pivotY, node.transform.rotation ?? 0,
              ),
            });
          }
        }
        if (degenerateParts.length > 0) {
          // 提示用户先去骨架编辑模式把关节拖到正确位置，而不是放任部件被甩飞
          toast({
            title: t('canvas.skeleton.jointPivot.title'),
            description: t('canvas.skeleton.jointPivot.description'),
          });
        }
        if (dependentParts.length === 0) {
          // 诊断日志：关节没有任何依赖部件，通常是绑骨后忘了重新生成手臂/腿的网格。
          // 保留这条日志便于排查「拖关节没反应」类问题（非热路径之外的每帧日志，开销可忽略）。
          console.warn(`[SkeletonOverlay] ${node.boneRole} has no dependent parts. Re-generate arm/leg mesh after rigging.`);
          // 打印所有带网格的部件及其绑定的关节，便于核对 jointBoneId 是否写错
          const armParts = effectiveNodes.filter(n => n.type === 'part' && n.mesh);
          console.log('[SkeletonOverlay] Parts with meshes:', armParts.map(p => ({ name: p.name, jointBoneId: p.mesh.jointBoneId })));
        } else {
          console.log(`[SkeletonOverlay] ${node.boneRole}: driving ${dependentParts.length} part(s), pivot=(${pivotX.toFixed(0)},${pivotY.toFixed(0)})`);
        }
      }

      // 段落 3.4：换算轴心的屏幕位置，用于后续把鼠标角度差映射成旋转量。
      // 轴心的世界位置 = 父世界矩阵 · (x + pivot)。推导：makeLocalMatrix 中
      // L·pivot = M·pivot + [(x+pivot) − M·pivot] = x + pivot（M 为父世界矩阵）。
      // 注意：这里**不能**用节点自身（可能已过期）的世界矩阵 wm·pivot —— 节点有旋转/缩放时会不精确。
      // 自动修复只改了 pivot，父链世界矩阵不受影响，因此用修复后的 pivotX/pivotY 代入仍然精确。
      const offsetX = node.transform.x ?? 0;
      const offsetY = node.transform.y ?? 0;
      const parentWorldMatrix = (node.parent && worldMap.has(node.parent)) ? worldMap.get(node.parent) : mat3Identity();
      const pivotWorldX = parentWorldMatrix[0] * (offsetX + pivotX) + parentWorldMatrix[3] * (offsetY + pivotY) + parentWorldMatrix[6];
      const pivotWorldY = parentWorldMatrix[1] * (offsetX + pivotX) + parentWorldMatrix[4] * (offsetY + pivotY) + parentWorldMatrix[7];
      const pivotScreenX = pivotWorldX * zoom + panX;
      const pivotScreenY = pivotWorldY * zoom + panY;

      // 记录起始角与起始旋转角：move 阶段用「当前角 - 起始角」得到相对旋转增量
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const dx = cssX - pivotScreenX;
      const dy = cssY - pivotScreenY;

      dragRef.current = {
        type: 'rotate',
        nodeId,
        startAngle: Math.atan2(dy, dx),
        startRotation: node.transform.rotation ?? 0,
        pivotScreenX,
        pivotScreenY,
        isAnimMode: editorModeRef.current === 'animation',
        dependentParts,
      };

      // 选中该骨骼，好让 GizmoOverlay 出现以便微调
      setSelection([nodeId]);

      // 编辑写操作前开启撤销批处理，让整次旋转拖动只算一步撤销
      if (editorModeRef.current === 'staging') {
        beginBatch(useProjectStore.getState().project);
      }
    }
  }, [skeletonEditMode, effectiveNodes, setSelection, updateProject, animations, animActiveAnimationId, animCurrentTime, animDraftPose, toast, t]);


  /**
   * 指针移动统一入口：根据 dragRef.current.type 分发处理。
   * 这是每帧调用的热路径，务必保持轻量（不要在此加日志）。
   *
   * @param {PointerEvent} e 指针事件
   */
  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return; // 没有进行中的拖动，直接返回（绝大多数鼠标移动都会走这里）
    const svg = svgRef.current;
    if (!svg) return; // SVG 未挂载，无法换算坐标
    const rect = svg.getBoundingClientRect();

    if (drag.type === 'joint') {
      // 段落 1：拖动关节 —— 把屏幕坐标换算成图像坐标后直接写 pivotX/pivotY。
      // skipHistory：拖动过程中的每一帧不单独记历史，靠 down/up 的批处理合并成一步撤销。
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const { zoom, panX, panY } = viewRef.current;
      const [imgX, imgY] = toImage(cssX, cssY, zoom, panX, panY);
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === drag.nodeId);
        if (node) {
          node.transform.pivotX = imgX;
          node.transform.pivotY = imgY;
        }
      }, { skipHistory: true });
    } else if (drag.type === 'rotate') {
      // 段落 2：拖动旋转弧 —— 由「当前角 - 起始角」得到旋转增量
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const dx = cssX - drag.pivotScreenX;
      const dy = cssY - drag.pivotScreenY;
      const currentAngle = Math.atan2(dy, dx);
      let delta = (currentAngle - drag.startAngle) * (180 / Math.PI); // 弧度差 → 角度差

      // Shift 吸附：按住 Shift 时把角度对齐到 15° 的整数倍，方便摆正姿势
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;

      if (drag.isAnimMode) {
        setDraftPoseRef.current(drag.nodeId, { rotation: drag.startRotation + delta });
      } else {
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === drag.nodeId);
          if (!node) return;
          // 兼容旧数据：transform 缺失时补默认变换
          if (!node.transform) node.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
          node.transform.rotation = drag.startRotation + delta;
        }, { skipHistory: true });
      }

      // 段落 2.1：四肢顶点蒙皮（仅肘/膝有关联部件时）。
      // 为什么统一走 setDraftPose：无论 staging 还是 animation 模式，都要经过
      // CanvasViewport tick 里的 GPU 上传路径把顶点刷进显存，走草稿是最省事且一致的通道。
      //
      // 两种基准（由 down 阶段决定 dep.baseVerts 是否为 null）：
      //   - 绝对式（staging）：角度 = 骨骼绝对旋转，基线 = 静止坐标 → 结果只取决于当前角度，
      //                        历史坏形变被自动抹掉（自愈），来回拖动不会累积误差；
      //   - 增量式（animation）：角度 = 本次拖动增量，基线 = 草稿 / 关键帧顶点，
      //                        保持关键帧语义不变。
      if (drag.dependentParts && drag.dependentParts.length > 0) {
        for (const dep of drag.dependentParts) {
          const angleDeg = dep.baseVerts ? delta : (drag.startRotation + delta);

          // 顶点旋转（含权重缩放）统一走共享函数，避免与自愈路径出现两套公式
          const newVerts = poseLimbVertices(
            dep.restVerts, dep.baseVerts, dep.boneWeights,
            dep.imgPivotX, dep.imgPivotY, angleDeg,
          );

          // staging 与 animation 模式都写草稿：前者由 CanvasViewport 的 GPU 上传块消费
          setDraftPoseRef.current(dep.partId, { mesh_verts: newVerts });
        }
      }
    } else if (drag.type === 'trackpad') {
      // 段落 3：拖动眼睛虹膜滑杆 —— 逻辑与 down 阶段一致（偏移限幅后归一化）
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      const dx = cssX - drag.tpX;
      const dy = cssY - drag.tpY;
      const TP_SIZE = 80;       // 与 down 阶段保持一致：滑杆边长（屏幕像素）
      const half = TP_SIZE / 2; // 半边长
      const MAX_OFFSET = 40;    // 滑杆边缘对应的最大虹膜偏移量（图像像素）
      let clampedOffsetX = dx;
      if (clampedOffsetX < -half) clampedOffsetX = -half;
      if (clampedOffsetX > half) clampedOffsetX = half;
      let clampedOffsetY = dy;
      if (clampedOffsetY < -half) clampedOffsetY = -half;
      if (clampedOffsetY > half) clampedOffsetY = half;
      const newX = (clampedOffsetX / half) * MAX_OFFSET;
      const newY = (clampedOffsetY / half) * MAX_OFFSET;

      if (drag.isAnimMode) {
         setDraftPoseRef.current(drag.nodeId, { x: newX, y: newY });
      } else {
         updateProject((proj) => {
           const pn = proj.nodes.find(n => n.id === drag.nodeId);
           if (!pn) return;
           // 兼容旧数据：transform 缺失时补默认变换
           if (!pn.transform) pn.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
           pn.transform.x = newX;
           pn.transform.y = newY;
         }, { skipHistory: true });
      }
    }
  }, [updateProject, effectiveNodes]);

  // clearDraftPoseForNode 的最新值快照（同上，避免 onPointerUp 闭包读到过期函数）
  const clearDraftPoseForNodeRef = useRef(clearDraftPoseForNode);
  useEffect(() => { clearDraftPoseForNodeRef.current = clearDraftPoseForNode; }, [clearDraftPoseForNode]);

  /**
   * 指针抬起/离开统一收尾：提交蒙皮结果、结束撤销批处理、触发自动关键帧。
   * 之所以 onPointerLeave 也绑定到它：拖出 SVG 边界时必须收尾，否则 dragRef 会卡住。
   */
  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null; // 先清空拖动状态，避免收尾过程中再次触发 move

    // 段落 1：拖动结束时提交蒙皮结果（仅旋转拖动且有关联部件时）
    if (drag?.type === 'rotate' && drag.dependentParts?.length > 0) {
      if (!drag.isAnimMode) {
        // staging 模式：把形变后的顶点写回基础网格，使下次拖动从正确的形变位置开始，
        // 再清掉草稿，让 GPU 上传从基础网格恢复。
        // 注意：必须在 endBatch() 之前提交 —— 否则这次「网格烘焙」会落在批处理
        // 之外成为单独的历史快照，用户按一次 Ctrl+Z 只能撤回骨骼旋转、撤不掉
        // 被烘焙的形变，看起来就像「部件被永久扭曲、撤销无效」。
        for (const dep of drag.dependentParts) {
          // 从动画 store 取「最新一帧」的草稿顶点（而非本闭包里的旧变量），确保提交的是用户最终看到的结果
          const latestVerts = useAnimationStore.getState().draftPose.get(dep.partId)?.mesh_verts;
          if (latestVerts) {
            updateProject(proj => {
              const pt = proj.nodes.find(n => n.id === dep.partId);
              if (pt?.mesh) pt.mesh.vertices = latestVerts.map(v => ({ ...v }));
            });
          }
          clearDraftPoseForNodeRef.current(dep.partId); // 清草稿，让渲染回落到刚写回的基础网格
        }
      }
      // animation 模式：草稿保留不提交，等用户按 K 键显式打关键帧
    }

    // 结束撤销批处理：把 down→up 期间的多次修改合并成历史里的一步
    endBatch();

    // 段落 2：自动关键帧 —— 动画模式下若开启了自动打帧，拖动结束后模拟一次 K 键
    if (drag && (drag.type === 'rotate' || drag.type === 'trackpad')) {
      if (useEditorStore.getState().autoKeyframe && editorModeRef.current === 'animation') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    }
  }, [updateProject]);


  /* ── 提前返回：以下判断必须在所有 Hooks 之后，否则会违反 Hooks 调用顺序 ── */

  const hasArmature = Object.keys(boneNodes).length > 0;
  if (!hasArmature) return null;   // 没有骨架（无 boneRole 的 group），无需渲染叠层
  if (!showSkeleton) return null;  // 用户关闭了骨架显示
  if (editorMode !== 'staging' && editorMode !== 'animation') return null; // 仅这两个模式支持骨架交互

  const { zoom, panX, panY } = view;

  /* ── 计算世界矩阵与轴心屏幕坐标辅助函数 ── */

  const worldMap = computeWorldMatrices(effectiveNodes);

  /**
   * 取某骨骼「轴心」的屏幕坐标（渲染骨骼线与关节圆时使用）。
   * 注：此处用节点自身的世界矩阵 · pivot。渲染阶段节点矩阵是当前帧算出的、未过期，
   * 因此精确；拖动命中换算那一侧才必须改用父矩阵公式（见 onPointerDown 段落 3.4）。
   *
   * @param {object} node 骨骼节点
   * @returns {[number, number]} [屏幕 x, 屏幕 y]
   */
  function pivotScreenPos(node) {
    const worldMatrix = worldMap.get(node.id) ?? mat3Identity();
    const pivotWorldX = worldMatrix[0] * node.transform.pivotX + worldMatrix[3] * node.transform.pivotY + worldMatrix[6];
    const pivotWorldY = worldMatrix[1] * node.transform.pivotX + worldMatrix[4] * node.transform.pivotY + worldMatrix[7];
    return [pivotWorldX * zoom + panX, pivotWorldY * zoom + panY];
  }

  /* ── 构建 SVG 元素 ── */

  // 关节圆半径：编辑模式放大，便于命中
  const radius = skeletonEditMode ? JOINT_RADIUS_EDIT : JOINT_RADIUS_NORMAL;

  // 段落 1：骨骼连线 —— 按 SKELETON_CONNECTIONS 声明的角色对连线，任一端缺失就跳过。
  // 线不接收指针事件（pointerEvents="none"），避免盖住关节圆与旋转弧导致点不中。
  const lines = [];
  for (const [fromRole, toRole] of SKELETON_CONNECTIONS) {
    const from = boneNodes[fromRole];
    const to   = boneNodes[toRole];
    if (!from || !to) continue; // 该连接的一端骨骼不存在，跳过
    const [x1, y1] = pivotScreenPos(from);
    const [x2, y2] = pivotScreenPos(to);
    lines.push(
      <line key={`${fromRole}-${toRole}`}
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={LINE_COLOUR} strokeWidth={skeletonEditMode ? 2 : 1.5}
        strokeLinecap="round" pointerEvents="none"
      />
    );
  }

  // 段落 2：关节圆点 + 编辑模式下的关节名标签
  const circles = [];
  for (const [role, node] of Object.entries(boneNodes)) {
    if (role === 'root') continue; // root 是整体根，没有可拖的关节意义，不渲染
    const [cx, cy] = pivotScreenPos(node);
    const isDragging = dragRef.current?.nodeId === node.id;
    // 填充色体现状态：正在拖（青）> 可拖（黄）> 普通（红）
    const fill = isDragging ? COLOUR_DRAG : (skeletonEditMode ? COLOUR_EDIT : COLOUR_NORMAL);
    circles.push(
      <circle key={role}
        cx={cx} cy={cy} r={radius}
        fill={fill} stroke="#000" strokeWidth={1.5}
        style={{ cursor: skeletonEditMode ? 'grab' : 'pointer', pointerEvents: 'auto' }}
        onPointerDown={(e) => onPointerDown(e, node.id, 'joint')}
        onClick={() => !skeletonEditMode && setSelection([node.id])}
      />
    );
    if (skeletonEditMode) {
      // 编辑模式下在圆点下方显示本地化关节名，帮助用户辨认各关节（关节名仅做本地化显示）
      const displayRole = labelFor(role, lang);
      const labelY = cy + radius + 11;
      const charWidth = 5.4; // 小字号下每个字符约 5.4px，用于估算标签背景宽度
      const labelWidth = displayRole.length * charWidth + 8;
      const labelHeight = 13;

      circles.push(
        <g key={`${role}-label`}>
          <rect
            x={cx - labelWidth / 2}
            y={labelY - 9.5}
            width={labelWidth}
            height={labelHeight}
            rx={4}
            fill="rgba(0,0,0,0.55)"
            pointerEvents="none"
          />
          <text
            x={cx} y={labelY}
            textAnchor="middle" fontSize={9}
            fill="white" pointerEvents="none"
            style={{ userSelect: 'none', fontWeight: 500 }}
          >
            {displayRole}
          </text>
        </g>
      );
    }
  }

  // 段落 3：眼睛虹膜滑杆 + 旋转弧（同一循环里按角色分发）
  const arcs = [];
  const trackpads = [];
  for (const [role, node] of Object.entries(boneNodes)) {
    if (role === 'eyes' && !skeletonEditMode) {
      // 段落 3.1：眼睛虹膜 2D 滑杆 —— 以眼睛关节的世界位置为基准，向上偏移固定距离放置
      const parentId = node.parent;
      let parentWorldMatrix = mat3Identity();
      if (parentId && worldMap.has(parentId)) {
         parentWorldMatrix = worldMap.get(parentId);
      }
      const pivotWorldX = parentWorldMatrix[0] * node.transform.pivotX + parentWorldMatrix[3] * node.transform.pivotY + parentWorldMatrix[6];
      const pivotWorldY = parentWorldMatrix[1] * node.transform.pivotX + parentWorldMatrix[4] * node.transform.pivotY + parentWorldMatrix[7];

      const cx = pivotWorldX * zoom + panX;
      const cy = pivotWorldY * zoom + panY;

      const TP_OFFSET_X = 0;
      const TP_OFFSET_Y = -120; // 上移到头顶上方（屏幕像素）；必须与 onPointerDown 的偏移保持一致
      const trackpadScreenX = cx + TP_OFFSET_X;
      const trackpadScreenY = cy + TP_OFFSET_Y;

      const TP_SIZE = 80;        // 滑杆边长（屏幕像素）
      const half = TP_SIZE / 2;  // 半边长
      const MAX_OFFSET = 40;     // 滑杆边缘对应的最大虹膜偏移量（图像像素）

      // 当前虹膜偏移 → 反推滑块在滑杆上的位置（与拖动写入的 newX/newY 互为逆运算）
      const irisOffsetX = node.transform.x || 0;
      const irisOffsetY = node.transform.y || 0;

      const knobX = trackpadScreenX + (irisOffsetX / MAX_OFFSET) * half;
      const knobY = trackpadScreenY + (irisOffsetY / MAX_OFFSET) * half;

      const isActive = dragRef.current?.type === 'trackpad' && dragRef.current?.nodeId === node.id;

      trackpads.push(
        <g key={`trackpad-${role}`}>
          <text x={trackpadScreenX} y={trackpadScreenY - half - 8} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.8)" style={{ userSelect: 'none', pointerEvents: 'none', fontWeight: 600 }}>
            {t('canvas.skeleton.irisOffset')}
          </text>
          <rect
             x={trackpadScreenX - half} y={trackpadScreenY - half} width={TP_SIZE} height={TP_SIZE} rx={8}
             fill="rgba(20,20,20,0.75)" stroke="rgba(255,255,255,0.2)" strokeWidth={1}
             style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
             onPointerDown={(e) => onPointerDown(e, node.id, 'trackpad')}
          />
          <line x1={trackpadScreenX} y1={trackpadScreenY - half} x2={trackpadScreenX} y2={trackpadScreenY + half} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="2 2" pointerEvents="none" />
          <line x1={trackpadScreenX - half} y1={trackpadScreenY} x2={trackpadScreenX + half} y2={trackpadScreenY} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="2 2" pointerEvents="none" />
          <circle
             cx={knobX} cy={knobY} r={isActive ? 8 : 6}
             fill={isActive ? '#22d3ee' : '#facc15'}
             style={{ pointerEvents: 'none' }}
          />
        </g>
      );
      continue; // 眼睛只画滑杆，不画旋转弧
    }

    // 段落 3.2：旋转弧 —— 只对白名单骨骼、且非编辑模式显示
    if (!ARC_BONE_ROLES.has(role) || skeletonEditMode) continue;
    const [cx, cy] = pivotScreenPos(node);
    const worldMatrix = worldMap.get(node.id) ?? mat3Identity();
    // 让弧的 90° 缺口朝向骨骼局部 Y 轴正方向（轴心向上的方向）：
    // atan2(m[4], m[3]) 取的是局部 X 轴在世界中的角度，再 -90° 即旋转到局部 Y 轴方向。
    const arcOrientDeg = Math.atan2(worldMatrix[4], worldMatrix[3]) * (180 / Math.PI) - 90;
    const isActive = dragRef.current?.type === 'rotate' && dragRef.current?.nodeId === node.id;
    arcs.push(
      <path key={`arc-${role}`}
        d={arcPath(cx, cy, ARC_RADIUS, arcOrientDeg, ARC_SWEEP_DEG)}
        fill="none"
        stroke={isActive ? ARC_ACTIVE : ARC_COLOUR}
        strokeWidth={ARC_STROKE_W}
        strokeLinecap="round"
        style={{ cursor: 'alias', pointerEvents: 'visibleStroke' }}
        onPointerDown={(e) => onPointerDown(e, node.id, 'rotate')}
      />
    );
  }

  return (
    <>
      {/* SVG 本体不吃指针事件（pointerEvents:'none'），让未命中任何元素的区域穿透到下面的画布；
          只有子元素（关节圆/滑杆/弧线）各自把 pointerEvents 设为 auto/visibleStroke 来接收交互，
          事件再冒泡到这里的 onPointerMove/onPointerUp 统一处理。 */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* 叠放顺序即命中优先级（后画的在上层）：弧 → 线 → 关节圆 → 滑杆 */}
        {arcs}
        {lines}
        {circles}
        {trackpads}
      </svg>

      {/* 骨架编辑模式的顶部浮动说明条（非模态，保持画布可交互） */}
      {skeletonEditMode && (
        <div className="absolute top-0 inset-x-0 z-40 flex items-center gap-4 px-4 py-2
                        bg-background border-b border-border">
          <span className="text-xs font-semibold text-foreground">{t('canvas.joints.title')}</span>
          <span className="text-xs text-muted-foreground flex-1">
            {t('canvas.joints.hint')}
          </span>
        </div>
      )}
    </>
  );
}

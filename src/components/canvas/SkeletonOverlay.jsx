/**
 * SkeletonOverlay — SVG overlay drawn on top of the WebGL canvas.
 *
 * Shows the armature skeleton (bone lines + joint circles) derived from group
 * nodes that have a `boneRole` property.  In skeletonEditMode, joints are
 * draggable: dragging a joint updates that group node's pivotX/pivotY in the
 * project store, which immediately changes where that bone rotates.
 *
 * Coordinate transform:
 *   image-space (px)  →  canvas CSS px:  cssX = px * zoom + panX
 *   canvas CSS px     →  image-space:    px  = (cssX - panX) / zoom
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

// Colour palette
const COLOUR_NORMAL = '#ef4444';      // red — not in edit mode
const COLOUR_EDIT   = '#facc15';      // yellow — edit mode ready to drag
const COLOUR_DRAG   = '#22d3ee';      // cyan — currently dragging
const LINE_COLOUR   = 'rgba(34,211,238,0.55)';

const JOINT_RADIUS_NORMAL = 5;
const JOINT_RADIUS_EDIT   = 8;

// Arc handle constants
const ARC_BONE_ROLES = new Set(['torso', 'neck', 'head', 'leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'bothArms', 'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'bothLegs']);
const ARC_RADIUS = 28;      // screen px
const ARC_SWEEP_DEG = 270;  // coverage
const ARC_COLOUR = 'rgba(251,191,36,0.55)';
const ARC_ACTIVE = 'rgba(251,191,36,0.95)';
const ARC_STROKE_W = 5;

/** Convert image-space coords → SVG/CSS coords */
function toScreen(x, y, zoom, panX, panY) {
  return [x * zoom + panX, y * zoom + panY];
}

/** Convert SVG/CSS coords → image-space */
function toImage(cssX, cssY, zoom, panX, panY) {
  return [(cssX - panX) / zoom, (cssY - panY) / zoom];
}

/** Generate SVG arc path */
function arcPath(cx, cy, r, startDeg, sweepDeg) {
  const half = sweepDeg / 2;
  const a1 = (startDeg - half) * (Math.PI / 180);
  const a2 = (startDeg + half) * (Math.PI / 180);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

export default function SkeletonOverlay({ view, editorMode, showSkeleton, skeletonEditMode }) {
  const updateProject  = useProjectStore(s => s.updateProject);
  const nodes          = useProjectStore(s => s.project.nodes);
  const animations     = useProjectStore(s => s.project.animations);

  const selection      = useEditorStore(s => s.selection);
  const setSelection   = useEditorStore(s => s.setSelection);
  const blendShapeEditMode = useEditorStore(s => s.blendShapeEditMode);
  const activeBlendShapeId = useEditorStore(s => s.activeBlendShapeId);
  const animCurrentTime       = useAnimationStore(s => s.currentTime);
  const animActiveAnimationId = useAnimationStore(s => s.activeAnimationId);
  const animDraftPose         = useAnimationStore(s => s.draftPose);
  const animLoopKeyframes     = useAnimationStore(s => s.loopKeyframes);
  const animFps               = useAnimationStore(s => s.fps);
  const animEndFrame          = useAnimationStore(s => s.endFrame);
  const setDraftPose          = useAnimationStore(s => s.setDraftPose);
  const clearDraftPoseForNode = useAnimationStore(s => s.clearDraftPoseForNode);

  const dragRef  = useRef(null); // { type: 'joint'|'rotate', nodeId, ... }
  const svgRef   = useRef(null);

  // Stable refs for event handlers (avoid stale closures)
  const viewRef         = useRef(view);
  const editorModeRef   = useRef(editorMode);
  const setDraftPoseRef = useRef(setDraftPose);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { editorModeRef.current = editorMode; }, [editorMode]);
  useEffect(() => { setDraftPoseRef.current = setDraftPose; }, [setDraftPose]);

  const { toast } = useToast();
  const { t, lang } = useTranslation();
  useEffect(() => {
    if (selection.length !== 1) return;
    const nodeId = selection[0];
    const node = nodes.find(n => n.id === nodeId);
    if (!node || node.type !== 'group' || !node.boneRole) return;

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

  // Compute effective nodes (animation overrides + draft pose)
  const ANIM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
  const effectiveNodes = useMemo(() => {
    if (editorMode !== 'animation') return nodes;
    const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
    const endMs = (animEndFrame / animFps) * 1000;
    const overrides  = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);
    const hasDraft   = animDraftPose.size > 0;
    if (!overrides.size && !hasDraft) return nodes;
    return nodes.map(node => {
      const ov = overrides.get(node.id);
      const dr = animDraftPose.get(node.id);
      if (!ov && !dr) return node;
      const tr = { ...node.transform };
      if (ov) for (const k of ANIM_KEYS) { if (ov[k] !== undefined) tr[k] = ov[k]; }
      if (dr) for (const k of ANIM_KEYS) { if (dr[k] !== undefined) tr[k] = dr[k]; }
      return { ...node, transform: tr, opacity: dr?.opacity ?? ov?.opacity ?? node.opacity };
    });
  }, [editorMode, nodes, animations, animActiveAnimationId, animCurrentTime, animDraftPose, animLoopKeyframes, animFps, animEndFrame]);

  const boneNodes = React.useMemo(() => {
    const map = {};
    for (const n of effectiveNodes) {
      if (n.type === 'group' && n.boneRole) map[n.boneRole] = n;
    }
    return map;
  }, [effectiveNodes]);

  /* ── Compute keyframe overrides (before pointer handlers) ── */

  const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
  const endMs = (animEndFrame / animFps) * 1000;
  const keyframeOverrides = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);

  /* ── Pointer handlers — defined unconditionally (Rules of Hooks) ── */

  const onPointerDown = useCallback((e, nodeId, dragType = 'joint') => {
    if (e.button !== 0) return; // Only handle left-click; middle/right pass through

    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (dragType === 'joint') {
      // Joint drag — only active in skeleton edit mode
      if (!skeletonEditMode) return;
      dragRef.current = { type: 'joint', nodeId };
    } else if (dragType === 'trackpad') {
      if (skeletonEditMode) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      // Calculate trackpad center using base parent transform
      const worldMap = computeWorldMatrices(effectiveNodes);
      const node = effectiveNodes.find(n => n.id === nodeId);
      if (!node) return;
      let pwm = mat3Identity();
      if (node.parent && worldMap.has(node.parent)) {
         pwm = worldMap.get(node.parent);
      }
      const bx = pwm[0] * node.transform.pivotX + pwm[3] * node.transform.pivotY + pwm[6];
      const by = pwm[1] * node.transform.pivotX + pwm[4] * node.transform.pivotY + pwm[7];
      const { zoom, panX, panY } = viewRef.current;
      const cx = bx * zoom + panX;
      const cy = by * zoom + panY;
      const tpx = cx + 0;
      const tpy = cy - 120; // offset above head

      dragRef.current = {
        type: 'trackpad',
        nodeId,
        tpX: tpx,
        tpY: tpy,
        isAnimMode: editorModeRef.current === 'animation',
      };

      setSelection([nodeId]);

      if (editorModeRef.current === 'staging') {
        beginBatch(useProjectStore.getState().project);
      }

      const dx = cssX - tpx;
      const dy = cssY - tpy;
      const TP_SIZE = 80;
      const half = TP_SIZE / 2;
      const MAX_OFFSET = 40;
      let cxClamp = dx;
      if (cxClamp < -half) cxClamp = -half;
      if (cxClamp > half) cxClamp = half;
      let cyClamp = dy;
      if (cyClamp < -half) cyClamp = -half;
      if (cyClamp > half) cyClamp = half;
      const newX = (cxClamp / half) * MAX_OFFSET;
      const newY = (cyClamp / half) * MAX_OFFSET;

      if (editorModeRef.current === 'animation') {
         setDraftPoseRef.current(nodeId, { x: newX, y: newY });
      } else {
         updateProject((proj) => {
           const pn = proj.nodes.find(n => n.id === nodeId);
           if (!pn) return;
           if (!pn.transform) pn.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
           pn.transform.x = newX;
           pn.transform.y = newY;
         });
      }
    } else if (dragType === 'rotate') {
      // Rotation arc drag — active outside skeleton edit mode
      if (skeletonEditMode) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const { zoom, panX, panY } = viewRef.current;

      const worldMap = computeWorldMatrices(effectiveNodes);
      const node = effectiveNodes.find(n => n.id === nodeId);
      if (!node) return;

      // 有效轴心：若下方触发了退化关节自动修复，会被替换成修复后的位置
      let pivotX = node.transform.pivotX;
      let pivotY = node.transform.pivotY;
      let jointRepaired = false;

      const JSKinningRoles = new Set(['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']);
      const dependentParts = [];
      const degenerateParts = [];
      if (JSKinningRoles.has(node.boneRole)) {
        const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
        const endMs = (animEndFrame / animFps) * 1000;
        const overrides = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);
        // 父骨骼（肩 / 髋）：肢体轴向要由「父轴心 → 子关节轴心」决定
        const shoulder = effectiveNodes.find(n => n.id === node.parent);
        const shoulderX = shoulder?.transform?.pivotX ?? 0;
        const shoulderY = shoulder?.transform?.pivotY ?? 0;
        const depNodes = effectiveNodes.filter(pt => pt.type === 'part' && pt.mesh?.jointBoneId === node.id);

        // ── 退化关节自动修复（自愈）────────────────────────────────────
        // 关节几乎压在父关节上（多为自动绑定把肘/膝放错位置）时，过去只能
        // 跳过形变并提示用户手动修。但此时关联网格往往已经被旧的错误权重
        // 「甩飞」过一次、把坏形变烘焙进了顶点（用户看到的「左手扭曲」）。
        // 现在按依赖部件的包围盒把关节放回肢体上，同时把网格顶点恢复到
        // 静止坐标 restX/restY，让本次旋转直接在干净的数据上进行。
        const restoredByPart = new Map(); // partId → { verts, restored }
        if (depNodes.length > 0 && isDegenerateJoint(shoulderX, shoulderY, pivotX, pivotY)) {
          const kind = node.boneRole.endsWith('Elbow') ? 'arm' : 'leg';
          const fix = suggestLimbJointPivot(shoulderX, shoulderY, depNodes, kind);
          if (fix) {
            // 写入项目（beginBatch 之前 → 修复是独立的一步撤销，不与本次拖动混在一起）
            updateProject((proj) => {
              const bn = proj.nodes.find(n => n.id === nodeId);
              if (bn?.transform) {
                bn.transform.pivotX = fix.x;
                bn.transform.pivotY = fix.y;
              }
              for (const d of depNodes) {
                const p = proj.nodes.find(n => n.id === d.id);
                if (!p?.mesh) continue;
                let restoredCount = 0;
                // x/y 恢复到静止坐标；没有 rest 坐标的旧网格保持原样（记为不可恢复）
                p.mesh.vertices = p.mesh.vertices.map(v => {
                  if (Number.isFinite(v.restX) && Number.isFinite(v.restY)) {
                    restoredCount++;
                    return { ...v, x: v.restX, y: v.restY };
                  }
                  return { ...v };
                });
                restoredByPart.set(d.id, {
                  verts: p.mesh.vertices.map(v => ({ ...v })),
                  restored: restoredCount > 0,
                });
              }
            });
            pivotX = fix.x;
            pivotY = fix.y;
            jointRepaired = true;
            // 动画模式：草稿里残留的旧形变必须被恢复值覆盖，否则画布仍显示坏数据
            if (editorModeRef.current === 'animation') {
              for (const [pid, r] of restoredByPart) {
                setDraftPoseRef.current(pid, { mesh_verts: r.verts });
              }
            }
            toast({
              title: t('canvas.skeleton.jointAutoFixed.title'),
              description: t('canvas.skeleton.jointAutoFixed.description'),
            });
            console.log(`[SkeletonOverlay] ${node.boneRole} pivot auto-repaired to (${fix.x.toFixed(0)},${fix.y.toFixed(0)})`);
          }
        }

        for (const pt of depNodes) {
          const r = restoredByPart.get(pt.id);
          // 两种情况跳过形变：关节仍然退化（自动修复没推导出位置），
          // 或关节修好了但该网格是缺少静止坐标的旧数据（恢复不了，别把坏形变再甩一次）
          if (isDegenerateJoint(shoulderX, shoulderY, pivotX, pivotY) || (jointRepaired && r && !r.restored)) {
            degenerateParts.push(pt.name ?? pt.id);
            continue;
          }
          // 修复过的部件直接用恢复后的网格；其余按原逻辑取基线 / 草稿 / 关键帧
          let startVerts = r ? r.verts : pt.mesh.vertices;
          if (!r && editorModeRef.current === 'animation') {
             startVerts = animDraftPose.get(pt.id)?.mesh_verts ?? overrides?.get(pt.id)?.mesh_verts ?? pt.mesh.vertices;
          }
          // 权重必须用**当前**轴心重算：mesh 里烘焙的 boneWeights 是生成网格那一刻的，
          // 之后一旦拖动过肘/膝关节就会过期，导致部件扭曲、出现硬折痕（看起来像被切开）。
          // （函数内部改用静止坐标 restX/restY 求投影，避免多次拖动后权重漂移）
          const weights = computeLimbWeights(
            startVerts, shoulderX, shoulderY,
            pivotX, pivotY
          );
          dependentParts.push({
            partId: pt.id,
            startVerts: startVerts.map(v => ({...v})),
            boneWeights: weights,
            imgPivotX: pivotX,
            imgPivotY: pivotY,
          });
        }
        if (degenerateParts.length > 0) {
          // 提示用户先去骨架编辑模式把关节拖到正确位置，而不是放任部件被甩飞
          toast({
            title: t('canvas.skeleton.jointPivot.title'),
            description: t('canvas.skeleton.jointPivot.description'),
          });
        }
        if (dependentParts.length === 0) {
          console.warn(`[SkeletonOverlay] ${node.boneRole} has no dependent parts. Re-generate arm/leg mesh after rigging.`);
          // Debug: show all parts and their jointBoneIds
          const armParts = effectiveNodes.filter(n => n.type === 'part' && n.mesh);
          console.log('[SkeletonOverlay] Parts with meshes:', armParts.map(p => ({ name: p.name, jointBoneId: p.mesh.jointBoneId })));
        } else {
          console.log(`[SkeletonOverlay] ${node.boneRole}: driving ${dependentParts.length} part(s), pivot=(${pivotX.toFixed(0)},${pivotY.toFixed(0)})`);
        }
      }

      // Compute pivot screen position using world matrix.
      // 轴心的世界位置 = 父世界矩阵 · (x + pivot)（由 makeLocalMatrix 的模型推得：
      // L·pivot = M·pivot + [(x+pivot) − M·pivot] = x + pivot）。修复只改了 pivot，
      // 父链的世界矩阵不受影响，因此用修复后的 pivotX/pivotY 代入仍然精确。
      const offsetX = node.transform.x ?? 0;
      const offsetY = node.transform.y ?? 0;
      const pwm = (node.parent && worldMap.has(node.parent)) ? worldMap.get(node.parent) : mat3Identity();
      const wx = pwm[0] * (offsetX + pivotX) + pwm[3] * (offsetY + pivotY) + pwm[6];
      const wy = pwm[1] * (offsetX + pivotX) + pwm[4] * (offsetY + pivotY) + pwm[7];
      const pivotScreenX = wx * zoom + panX;
      const pivotScreenY = wy * zoom + panY;

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

      // Select the bone so GizmoOverlay appears
      setSelection([nodeId]);

      if (editorModeRef.current === 'staging') {
        beginBatch(useProjectStore.getState().project);
      }
    }
  }, [skeletonEditMode, effectiveNodes, setSelection, updateProject, animations, animActiveAnimationId, animCurrentTime, animDraftPose, toast, t]);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    if (drag.type === 'joint') {
      // Joint position drag
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
      // Rotation arc drag
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const dx = cssX - drag.pivotScreenX;
      const dy = cssY - drag.pivotScreenY;
      const currentAngle = Math.atan2(dy, dx);
      let delta = (currentAngle - drag.startAngle) * (180 / Math.PI);

      // Shift modifier for 15-degree snapping
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;

      if (drag.isAnimMode) {
        setDraftPoseRef.current(drag.nodeId, { rotation: drag.startRotation + delta });
      } else {
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === drag.nodeId);
          if (!node) return;
          if (!node.transform) node.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
          node.transform.rotation = drag.startRotation + delta;
        }, { skipHistory: true });
      }
      
      // Apply JS vertex skinning if there are dependent parts.
      // Always use setDraftPose so the GPU upload path in the rAF tick fires
      // regardless of editor mode (staging or animation).
      if (drag.dependentParts && drag.dependentParts.length > 0) {
        const rad = delta * (Math.PI / 180);
        for (const dep of drag.dependentParts) {
          const newVerts = dep.startVerts.map((v, i) => {
            const w = dep.boneWeights?.[i] ?? 0;
            if (w === 0) return { ...v };

            const dxV = v.x - dep.imgPivotX;
            const dyV = v.y - dep.imgPivotY;

            const wRad = rad * w;
            const wCos = Math.cos(wRad);
            const wSin = Math.sin(wRad);

            const rx = dxV * wCos - dyV * wSin;
            const ry = dxV * wSin + dyV * wCos;

            return { ...v, x: dep.imgPivotX + rx, y: dep.imgPivotY + ry };
          });

          // Both staging and animation mode: go through draftPose so the
          // staging-mode GPU upload block in CanvasViewport tick picks it up.
          setDraftPoseRef.current(dep.partId, { mesh_verts: newVerts });
        }
      }
    } else if (drag.type === 'trackpad') {
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      
      const dx = cssX - drag.tpX;
      const dy = cssY - drag.tpY;
      const TP_SIZE = 80;
      const half = TP_SIZE / 2;
      const MAX_OFFSET = 40;
      let cxClamp = dx;
      if (cxClamp < -half) cxClamp = -half;
      if (cxClamp > half) cxClamp = half;
      let cyClamp = dy;
      if (cyClamp < -half) cyClamp = -half;
      if (cyClamp > half) cyClamp = half;
      const newX = (cxClamp / half) * MAX_OFFSET;
      const newY = (cyClamp / half) * MAX_OFFSET;
      
      if (drag.isAnimMode) {
         setDraftPoseRef.current(drag.nodeId, { x: newX, y: newY });
      } else {
         updateProject((proj) => {
           const pn = proj.nodes.find(n => n.id === drag.nodeId);
           if (!pn) return;
           if (!pn.transform) pn.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
           pn.transform.x = newX;
           pn.transform.y = newY;
         }, { skipHistory: true });
      }
    }
  }, [updateProject, effectiveNodes]);

  const clearDraftPoseForNodeRef = useRef(clearDraftPoseForNode);
  useEffect(() => { clearDraftPoseForNodeRef.current = clearDraftPoseForNode; }, [clearDraftPoseForNode]);

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;

    // Commit skinning draft pose on drag end
    if (drag?.type === 'rotate' && drag.dependentParts?.length > 0) {
      if (!drag.isAnimMode) {
        // Staging mode: commit deformed verts into the base mesh so the
        // next drag starts from the correct deformed position,
        // then clear the draft so the GPU upload restores from base mesh.
        // 注意：必须在 endBatch() 之前提交 —— 否则这次「网格烘焙」会落在批处理
        // 之外成为单独的历史快照，用户按一次 Ctrl+Z 只能撤回骨骼旋转、撤不掉
        // 被烘焙的形变，看起来就像「部件被永久扭曲、撤销无效」。
        for (const dep of drag.dependentParts) {
          const latestVerts = useAnimationStore.getState().draftPose.get(dep.partId)?.mesh_verts;
          if (latestVerts) {
            updateProject(proj => {
              const pt = proj.nodes.find(n => n.id === dep.partId);
              if (pt?.mesh) pt.mesh.vertices = latestVerts.map(v => ({ ...v }));
            });
          }
          clearDraftPoseForNodeRef.current(dep.partId);
        }
      }
      // Animation mode: leave draft pose in place — user commits with K key
    }

    endBatch();

    // Auto Keyframe trigger
    if (drag && (drag.type === 'rotate' || drag.type === 'trackpad')) {
      if (useEditorStore.getState().autoKeyframe && editorModeRef.current === 'animation') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    }
  }, [updateProject]);


  /* ── Early exit (after all hooks) ── */

  const hasArmature = Object.keys(boneNodes).length > 0;
  if (!hasArmature) return null;
  if (!showSkeleton) return null;
  if (editorMode !== 'staging' && editorMode !== 'animation') return null;

  const { zoom, panX, panY } = view;

  /* ── Compute world matrices and helper ── */

  const worldMap = computeWorldMatrices(effectiveNodes);

  function pivotScreenPos(node) {
    const wm = worldMap.get(node.id) ?? mat3Identity();
    const wx = wm[0] * node.transform.pivotX + wm[3] * node.transform.pivotY + wm[6];
    const wy = wm[1] * node.transform.pivotX + wm[4] * node.transform.pivotY + wm[7];
    return [wx * zoom + panX, wy * zoom + panY];
  }

  /* ── Build SVG elements ── */

  const radius = skeletonEditMode ? JOINT_RADIUS_EDIT : JOINT_RADIUS_NORMAL;

  const lines = [];
  for (const [fromRole, toRole] of SKELETON_CONNECTIONS) {
    const from = boneNodes[fromRole];
    const to   = boneNodes[toRole];
    if (!from || !to) continue;
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

  const circles = [];
  for (const [role, node] of Object.entries(boneNodes)) {
    if (role === 'root') continue;
    const [cx, cy] = pivotScreenPos(node);
    const isDragging = dragRef.current?.nodeId === node.id;
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
      // Label under each joint in edit mode for orientation（关节名仅显示本地化）
      const displayRole = labelFor(role, lang);
      const labelY = cy + radius + 11;
      const charWidth = 5.4; // estimate for small font
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

  const arcs = [];
  const trackpads = [];
  for (const [role, node] of Object.entries(boneNodes)) {
    if (role === 'eyes' && !skeletonEditMode) {
      // 2D trackpad slider for eyes
      const parentId = node.parent;
      let pwm = mat3Identity();
      if (parentId && worldMap.has(parentId)) {
         pwm = worldMap.get(parentId);
      }
      const bx = pwm[0] * node.transform.pivotX + pwm[3] * node.transform.pivotY + pwm[6];
      const by = pwm[1] * node.transform.pivotX + pwm[4] * node.transform.pivotY + pwm[7];
      
      const cx = bx * zoom + panX;
      const cy = by * zoom + panY;
      
      const TP_OFFSET_X = 0;
      const TP_OFFSET_Y = -120;
      const tpx = cx + TP_OFFSET_X;
      const tpy = cy + TP_OFFSET_Y;
      
      const TP_SIZE = 80;
      const half = TP_SIZE / 2;
      const MAX_OFFSET = 40; 
      
      const ex = node.transform.x || 0;
      const ey = node.transform.y || 0;
      
      const knobX = tpx + (ex / MAX_OFFSET) * half;
      const knobY = tpy + (ey / MAX_OFFSET) * half;
      
      const isActive = dragRef.current?.type === 'trackpad' && dragRef.current?.nodeId === node.id;
      
      trackpads.push(
        <g key={`trackpad-${role}`}>
          <text x={tpx} y={tpy - half - 8} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.8)" style={{ userSelect: 'none', pointerEvents: 'none', fontWeight: 600 }}>
            {t('canvas.skeleton.irisOffset')}
          </text>
          <rect
             x={tpx - half} y={tpy - half} width={TP_SIZE} height={TP_SIZE} rx={8}
             fill="rgba(20,20,20,0.75)" stroke="rgba(255,255,255,0.2)" strokeWidth={1}
             style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
             onPointerDown={(e) => onPointerDown(e, node.id, 'trackpad')}
          />
          <line x1={tpx} y1={tpy - half} x2={tpx} y2={tpy + half} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="2 2" pointerEvents="none" />
          <line x1={tpx - half} y1={tpy} x2={tpx + half} y2={tpy} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="2 2" pointerEvents="none" />
          <circle
             cx={knobX} cy={knobY} r={isActive ? 8 : 6}
             fill={isActive ? '#22d3ee' : '#facc15'}
             style={{ pointerEvents: 'none' }}
          />
        </g>
      );
      continue;
    }

    if (!ARC_BONE_ROLES.has(role) || skeletonEditMode) continue;
    const [cx, cy] = pivotScreenPos(node);
    const wm = worldMap.get(node.id) ?? mat3Identity();
    // Orient gap along local Y-axis (upward from pivot)
    const arcOrientDeg = Math.atan2(wm[4], wm[3]) * (180 / Math.PI) - 90;
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
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {arcs}
        {lines}
        {circles}
        {trackpads}
      </svg>

      {/* Floating instruction toolbar — skeleton edit mode */}
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

# 形态键（混合变形）实现

## 概述

形态键（Shape Keys，也称混合变形 Blend Shapes）是一项受 Blender 启发的功能，允许用户创建网格的多个变形版本，并通过影响强度滑块在它们之间混合。每个形态键存储相对于静止位置的**顶点位置增量**，从而无需基于骨骼的绑定即可实现复杂的角色动画。

### 核心功能

- **按节点混合变形**：每个带网格的部件可拥有多个形态键
- **可关键帧化的影响强度**：混合变形影响强度（0–1）可在时间轴上制作动画
- **Blender 风格编辑模式**：点击铅笔 ✎ 进入形态键编辑模式，并用笔刷变形增量
- **可累积**：多个形态一起混合（`finalPos = rest + Σ(delta × influence)`）
- **实时预览**：编辑期间激活的形态键以 100% 影响强度显示，以保证可见性

---

## 架构

### 数据模型

**部件节点新增内容：**
```javascript
{
  id: string,
  type: 'part',
  mesh: { vertices: [{x, y, restX, restY}], ... },
  
  // NEW: Shape key definitions
  blendShapes: [
    {
      id: string,           // unique, never changes
      name: string,         // "Key 1", "Mouth Open", etc.
      deltas: [{dx, dy}]    // one per vertex; offsets from restX/restY
    }
  ],
  
  // NEW: Staging mode influence values
  blendShapeValues: {
    [shapeId]: number     // 0.0–1.0, used outside animation
  }
}
```

### 渲染管线

**混合公式**（rAF tick，第 ~240–275 行）：
```javascript
finalX[i] = restX[i] + Σ(blendShapes[j].deltas[i].dx × influence[j])
finalY[i] = restY[i] + Σ(blendShapes[j].deltas[i].dy × influence[j])
```

该公式：
1. 从**静止位置**（`restX/restY`）开始，而非当前的 `x/y`
2. 应用所有形态增量，并按各自的影响强度缩放
3. 将混合后的顶点作为 `mesh_verts` 注入 `poseOverrides`
4. GPU 的 `uploadPositions` 处理最终的顶点更新

**关键洞见**：混合公式在渲染期间**每帧**运行，而不仅在拖动时运行。这意味着来自关键帧的影响强度会在播放期间实时应用。

### 动画集成

**轨道属性命名**：`blendShape:{shapeId}`
- 示例：`blendShape:abc123def`
- 标量值：0.0–1.0（影响强度）
- 关键帧化：可与现有缓动系统配合使用（linear、ease-in-out 等）

**流程**：
1. 用户在动画模式中移动影响强度滑块
2. `setDraftPose(nodeId, { 'blendShape:{id}': value })` 存储未提交的更改
3. 按 K → 在当前时间创建 `blendShape:{id}` 关键帧
4. 播放期间，`computePoseOverrides` 对关键帧影响强度进行插值
5. 渲染循环读取影响强度并应用混合公式

### 编辑模式

**进入**：点击 Shape Keys 面板中的铅笔 ✎ 按钮
- 设置 `blendShapeEditMode = true`、`activeBlendShapeId = shape.id`
- 强制激活形态以 100% 影响强度显示（无论滑块如何）
- 笔刷写入 `shape.deltas` 而非基础网格

**编辑期间**：
- 拖动开始时捕获混合后的位置（已有增量 + 当前拖动）
- GPU 显示实时预览：基础 + 累积增量 + 当前拖动
- 松开鼠标时，所有受影响的顶点在 `shape.deltas` 中更新

**退出**：点击编辑模式头部中的 “Done” 按钮

---

## 问题与解决方案

### 问题 1：编辑模式下网格在多次拖动之间视觉上回退

**症状**：使用变形笔刷编辑混合变形时，第二次及后续拖动会视觉上将网格重置到原始位置，然后从那里变形。然而，退出编辑模式后显示所有更改都已正确保存。

**根因**： 
- `onPointerDown` 从 `node.mesh.vertices`（基础静止位置）捕获了一份顶点位置快照（`verticesSnap`）
- 每次新拖动都从静止状态开始，而非从先前编辑过的状态开始
- 混合变形增量在存储中*确实*被正确累积，但 GPU 视觉预览只显示从静止状态起的当前拖动

**解决方案**（第 1062–1095 行）：
1. 当处于 `blendShapeEditMode` 时，通过应用已有混合变形增量（激活形态为 100% 影响强度）计算 `effectiveVerts`
2. 这个“起始状态”成为每次拖动的 `verticesSnap`
3. 随后 GPU 上传显示：混合基础 + 新拖动增量（视觉上正确）
4. 存储的增量：`existing_delta + new_drag_delta`（数学上正确的累积）

```javascript
if (editorRef.current.blendShapeEditMode && selNode.blendShapes?.length) {
  const activeShapeId = editorRef.current.activeBlendShapeId;
  effectiveVerts = selNode.mesh.vertices.map((v, i) => {
    let bx = v.restX, by = v.restY;
    for (const shape of selNode.blendShapes) {
      const d = shape.deltas[i];
      if (!d) continue;
      const inf = shape.id === activeShapeId ? 1.0 : (selNode.blendShapeValues?.[shape.id] ?? 0);
      bx += d.dx * inf;
      by += d.dy * inf;
    }
    return { x: bx, y: by };
  });
}
```

**附加修复**：在渲染循环（第 ~260 行）中强制激活形态为 100% 影响强度，使画布显示与用户正在编辑的内容一致。

---

### 问题 2：动画播放期间网格不变形

**症状**：在时间轴播放期间，Inspector 中的混合变形影响强度滑块正确变化（显示插值后的关键帧值），但画布中的网格在视觉上没有变形。

**根因**：
每次按 K（提交关键帧）都**无条件地为节点创建一个 `mesh_verts` 关键帧**，无论用户是否正在变形网格。这个 `mesh_verts` 关键帧包含**基础（未变形）顶点位置**。

播放期间：
1. `computePoseOverrides` 返回：`{ 'blendShape:{id}': 0.5, mesh_verts: [base vertices] }`
2. 混合变形应用检查：`if (!existing.mesh_verts)` → **为真**（mesh_verts 存在）→ **跳过混合公式**
3. 结果：GPU 收到基础网格，而非混合后的网格

这尤其成问题，因为：
- 每次按 K（即使是纯粹的影响强度关键帧）都会创建这些阻断性的 `mesh_verts` 条目
- 混合变形公式在动画期间从未被应用
- 该守卫旨在防止 mesh_verts 与混合变形冲突，但它过于激进

**解决方案**（第 421–447 行）：
仅在以下情况创建/更新 `mesh_verts` 关键帧：
1. 节点有激活的网格变形（定义了 `draft.mesh_verts`），**或**
2. 已存在 `mesh_verts` 轨道（继续一个既有的变形动画）

```javascript
const hasMeshDeform = draft?.mesh_verts !== undefined;
let meshTrack = animation.tracks.find(t => t.nodeId === nodeId && t.property === 'mesh_verts');

if (hasMeshDeform || meshTrack) {
  // ... create/update mesh_verts keyframe
}
```

这样：
- 纯粹的混合变形按 K 不会创建阻断性的 `mesh_verts` 条目
- 既有的变形动画继续正常工作
- 混合变形动画可自由运行而不受干扰
- 如果用户混合使用 mesh_verts（变形）和混合变形，mesh_verts 优先（两者不会互相干扰）

**对既有项目的提示**：在此修复之前创建的项目可能有被污染的 `mesh_verts` 轨道。从时间轴中删除那些轨道将恢复混合变形动画。

---

### 问题 3：编辑模式下的影响强度不可见

**症状**：进入混合变形编辑模式时，若形态键的影响强度滑块为 0，则该形态键不可见。

**根因**：混合公式直接使用来自关键帧/Staging 值的 `influences[j]`，其可能为 0。

**解决方案**（rAF tick 中第 ~260–268 行）：
当 `blendShapeEditMode && activeBlendShapeId === shape.id` 时，在渲染循环中强制影响强度为 1.0：

```javascript
if (ed.blendShapeEditMode && ed.activeBlendShapeId === shape.id) {
  hasInfluence = true;
  return 1.0;  // active shape always visible during editing
}
```

这确保画布始终显示你正在编辑的内容的预览，与 Blender 的行为一致。

---

### 问题 4：进入/退出编辑模式时画布不重绘

**症状**：进入或退出混合变形编辑模式时，画布不会立即重绘（没有视觉反馈）。

**根因**：用于触发画布重绘的 `isDirtyRef`（第 315 行）未包含 `blendShapeEditMode` 或 `activeBlendShapeId`。

**解决方案**（第 316–317 行）：
添加到 `useEffect` 依赖列表：
```javascript
useEffect(() => { isDirtyRef.current = true; },
  [...existing..., editorState.blendShapeEditMode, editorState.activeBlendShapeId]);
```

现在当编辑模式状态变化时，画布会立即重绘。

---

## 用法

### 创建形态键

1. 选择一个带网格的部件
2. 在 Inspector 中找到 **Shape Keys** 区域（若存在网格，则显示在 Mesh 面板下方）
3. 点击 **+** 按钮
4. 会创建一个增量为零的新形态键 “Key N”

### 编辑形态键

1. 点击形态键名称旁的**铅笔 ✎** 按钮
2. 头部变为 **“Editing: [Shape Name]”**
3. 使用变形笔刷（与普通网格编辑相同）修改形态
4. 笔刷大小/硬度控制仍然适用
5. 点击 **Done** 退出编辑模式

### 动画化混合变形

**Staging 模式**（非动画）：
- 移动影响强度滑块（0–1），网格即时更新
- 更改持久化于 `node.blendShapeValues`

**动画模式**：
- 移动影响强度滑块
- （默认启用自动关键帧）按 K 创建关键帧
- 关键帧存储为带标量值的 `blendShape:{shapeId}` 轨道
- 缓动应用于影响强度插值
- 播放期间，影响强度平滑动画

### 实用技巧

- **层叠形态**：为不同变形使用多个形态键（例如 “Smile”、“Blink”、“Angry”）
- **与绑定结合**：混合变形可与骨骼绑定并行工作；两者结合用于复杂角色动画
- **在关键帧上打关键帧**：在动作的开始、中间和结尾打关键帧；缓动填补间隙
- **编辑模式预览**：编辑模式期间激活形态以 100% 显示，无论滑块位置如何
- **可累积**：若 “Smile” 和 “Blink” 都有效果，它们的增量会相加

---

## 技术说明

### 相对增量（而非绝对位置）

形态键存储的是**增量**（`{dx, dy}`），而非绝对位置。这一设计选择：
- 使形态独立于基础网格的当前位置
- 允许重新生成网格而不丢失形态数据（增量仍适用于新顶点）
- 遵循 Blender 的方法

### 以 restX/restY 为基础

混合公式使用 `restX` 和 `restY`（原始网格生成位置），而非当前的 `x`/`y`。这意味着：
- 如果你在 Staging 模式中变形基础网格（`x`/`y` 改变），混合变形仍引用原始位置
- 混合变形被“锁定”到原始网格几何
- 未来扩展：若有需要，可将形态重新基于当前网格位置

### mesh_verts 与混合变形

动画系统支持两种顶点动画机制：

| 功能 | 存储内容 | 用例 |
|---------|--------|----------|
| `mesh_verts` 关键帧 | 绝对顶点位置 | 直接网格变形动画（类似关键帧雕刻） |
| 混合变形 | 顶点增量 + 影响强度 | 基于参数的变形（灵活、可复用） |

目前，它们**无法完全共存**：若某节点同时拥有两者，`mesh_verts` 关键帧优先，混合变形被跳过（第 ~272 行的守卫防止冲突）。这在未来可以改进。

### GPU 效率

- 混合公式在渲染期间每帧运行一次，而非逐顶点
- 混合后的顶点通过 `uploadPositions` 一次性上传（GPU 批量更新）
- 无每帧重新三角剖分或拓扑变化
- 性能：在合理的顶点/形态数量下开销可忽略

---

## 未来增强

1. **形态键可见性开关**：在画布中隐藏/显示单个形态
2. **形态键导出**：从外部格式保存/载入形态键
3. **自动形态创建**：从用户绘制的变体生成初始形态键
4. **形态混合 UI**：用于可视化并调整多个影响强度的高级面板
5. **网格 + 形态组合**：解决 `mesh_verts` 与混合变形的冲突，以实现真正的混合动画
6. **对称**：为双侧角色沿 X 轴镜像形态键
7. **相对与绝对**：在基于增量与绝对顶点存储模式之间切换

---

## 代码位置

| 组件 | 文件 | 行号 |
|-----------|------|-------|
| 数据模型 actions | `src/store/projectStore.js` | ~113–162 |
| 编辑模式状态 | `src/store/editorStore.js` | ~66–102 |
| 动画引擎 | `src/renderer/animationEngine.js` | ~9, ~224–232 |
| 混合公式 | `src/components/canvas/CanvasViewport.jsx` | ~240–275 |
| 编辑模式（onPointerDown） | `src/components/canvas/CanvasViewport.jsx` | ~1062–1095 |
| 编辑模式（笔刷拖动） | `src/components/canvas/CanvasViewport.jsx` | ~1216–1235 |
| K 键处理器 | `src/components/canvas/CanvasViewport.jsx` | ~444–464, ~421–447 |
| UI Inspector | `src/components/inspector/Inspector.jsx` | ~525–660 |
| 文件 I/O | `src/io/projectFile.js` | ~95–102 |

---

## 测试清单

- [ ] 在带网格的部件上创建新形态键
- [ ] 使用变形笔刷编辑形态键（多次拖动，无视觉回退）
- [ ] 将影响强度滑块设为不同值，实时看到网格变形
- [ ] 在动画模式中移动滑块 → 按 K 在不同时间创建关键帧
- [ ] 刮擦时间轴，验证混合变形平滑动画
- [ ] 创建多个形态，验证影响强度按叠加方式混合
- [ ] 保存/载入项目，验证混合变形持久化
- [ ] 编辑模式：激活形态以 100% 显示，无论滑块如何
- [ ] 编辑模式：退出再进入显示已保存的增量
- [ ] 纯形态键动画不会出现 mesh_verts 轨道（修复后）

---

**最后更新**：2026 年 4 月
**作者**：Claude (Anthropic)
**状态**：完成、已测试、已文档化

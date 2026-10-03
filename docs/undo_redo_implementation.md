# 撤销/重做系统实现

## 概述

撤销/重做系统通过基于快照的历史管理，使用户能够回退和恢复动画项目的更改。每个可撤销的变更都流经单一注入点（projectStore.js 中的 `updateProject`），在此自动捕获快照。连续操作（拖动、滑块刮擦）会被批处理以抑制中间快照，确保 Ctrl+Z 跳转到有意义的状态。

**状态**：完成（M7 功能）  
**实现日期**：2026-04-17  
**修改文件数**：7 | **新建文件数**：1

---

## 架构

### 核心洞见

应用中的每个变更都流经 `projectStore.js` 中的 `updateProject(recipe, opts)`。我们不必追踪 30 多个单独的调用点，而是在 `updateProject` 内部、每次变更之前自动快照。为连续拖动/滑块操作添加 `beginBatch` / `endBatch` 机制，使每次手势只捕获一个快照，而非每帧一个。

### 历史机制

```
[User Action]
  ├─ (if not batching) → pushSnapshot(project)  [capture pre-mutation state]
  ├─ updateProject(recipe)                       [apply mutation]
  └─ (if batching) → skip snapshot

[User Undo: Ctrl+Z]
  ├─ undo(currentProject, applyFn)
  ├─ Pop snapshot from _snapshots
  ├─ Push currentProject to _redoStack
  └─ applyFn(snapshot)                           [restore project state]

[User Redo: Ctrl+Y or Shift+Ctrl+Z]
  ├─ redo(currentProject, applyFn)
  ├─ Pop snapshot from _redoStack
  ├─ Push currentProject to _snapshots
  └─ applyFn(snapshot)                           [restore project state]
```

### 连续操作的批处理

```
[User starts slider drag]
  └─ onPointerDown → beginBatch(project)         [_batchDepth++, snapshot if first]

[User moves slider continuously]
  └─ onChange calls updateProject → isBatching() returns true → skip snapshot

[User releases slider]
  └─ onPointerUp → endBatch()                    [_batchDepth--]

Result: One snapshot for entire drag gesture, Ctrl+Z jumps to pre-drag state.
```

### 无循环依赖

- `src/store/undoHistory.js` 是纯 JS，对 store 或 React 零导入
- `src/store/projectStore.js` 从 undoHistory 导入 `pushSnapshot`、`isBatching`、`clearHistory`
- `src/hooks/useUndoRedo.js` 从 undoHistory 导入 `undo`、`redo`
- `src/components/*` 按需从 undoHistory 导入 `beginBatch`、`endBatch`

---

## 实现细节

### 1. 核心模块：`src/store/undoHistory.js`

**用途**：管理撤销/重做历史栈和批处理操作的纯 JS 模块。

**状态**：
```javascript
let _snapshots = [];   // Past project snapshots (max 50)
let _redoStack  = [];  // Redo stack
let _batchDepth = 0;   // >0 means inside a continuous gesture
```

**关键函数**：

#### `pushSnapshot(project)`
- 使用 `structuredClone()` 深克隆项目（保留 Float32Array、Set、Map）
- 推入 `_snapshots` 数组（保留至 MAX_HISTORY=50）
- 清空 `_redoStack`（撤销后的任何新变更都会使重做历史失效）

**关键细节**：使用 `structuredClone()` 而非 `JSON.parse(JSON.stringify())`，因为：
- Float32Array（用于网格 UV）在 JSON 序列化时会变成 `{}` —— 撤销会丢失所有贴图坐标
- structuredClone 正确保留所有类型化数组数据

#### `beginBatch(project)`
- 若 `_batchDepth === 0`，捕获一个快照
- 递增 `_batchDepth` 以标记我们处于连续手势内
- 后续 `updateProject` 调用会看到 `isBatching() === true` 并跳过快照

#### `endBatch()`
- 安全地递减 `_batchDepth`（永不变为负数）
- 一旦为 0，下次 `updateProject` 将再次快照

#### `isBatching()`
- 若 `_batchDepth > 0` 则返回 `true`（供 projectStore 跳过快照）

#### `undo(currentProject, applyFn)`
- 从 `_snapshots` 数组弹出（若有）
- 将 `currentProject` 推入 `_redoStack` 以支持重做
- 调用 `applyFn(snapshot)` 恢复项目状态

#### `redo(currentProject, applyFn)`
- 从 `_redoStack` 弹出（若有）
- 将 `currentProject` 推入 `_snapshots`（它成为新的“过去”状态）
- 调用 `applyFn(snapshot)` 恢复项目状态

#### `clearHistory()`
- 在项目载入/重置时清除所有历史，使陈旧历史不会泄漏
- 在 `loadProject()` 和 `resetProject()` 中调用，以防止跨越新项目边界进行撤销

---

### 2. 注入点：`src/store/projectStore.js`

**导入**：
```javascript
import { pushSnapshot, isBatching, clearHistory } from '@/store/undoHistory';
```

**修改后的 updateProject 签名**：
```javascript
updateProject: (recipe, { skipHistory = false } = {}) => {
  set((state) => {
    if (!skipHistory && !isBatching()) {
      pushSnapshot(state.project);
    }
    return produce((draft) => {
      recipe(draft.project, draft.versionControl);
    })(state);
  });
}
```

**逻辑**：
- 应用 recipe 之前，检查是否应快照
- 若 `skipHistory: true` 则跳过（在应用撤销/重做时使用 —— 防止双重快照）
- 若 `isBatching()` 为 true 则跳过（连续手势进行中）
- 仅对离散变更自动快照

**调用处**：
- `resetProject()`：先调用 `clearHistory()`
- `loadProject()`：先调用 `clearHistory()`

**调用方保持不变**：所有现有的 `updateProject(recipe)` 调用照常工作（无第二个参数，默认为 `{ skipHistory: false }`）

---

### 3. 键盘处理器：`src/hooks/useUndoRedo.js`

**已重写**，改用 undoHistory 模块而非内联快照数组。

**关键模式**：
```javascript
import { undo, redo } from '@/store/undoHistory';

export function useUndoRedo() {
  const updateProject = useProjectStore(s => s.updateProject);
  const projectRef = useRef(null);

  // Subscribe to project changes to keep projectRef updated
  useEffect(() => {
    return useProjectStore.subscribe((state) => {
      projectRef.current = state.project;
    });
  }, []);

  // Keyboard handler
  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';

      if (isZ && !e.shiftKey) {
        // Ctrl+Z → Undo
        e.preventDefault();
        undo(projectRef.current, (snapshot) => {
          updateProject((proj) => {
            Object.assign(proj, snapshot);
          }, { skipHistory: true });
        });
      } else if (isY || (isZ && e.shiftKey)) {
        // Ctrl+Y or Ctrl+Shift+Z → Redo
        e.preventDefault();
        redo(projectRef.current, (snapshot) => {
          updateProject((proj) => {
            Object.assign(proj, snapshot);
          }, { skipHistory: true });
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [updateProject]);
}
```

**重要细节**：`skipHistory: true` 防止撤销/重做的应用本身推入另一个快照。否则，应用快照会触发 `pushSnapshot()` 并创建新的历史条目，破坏撤销链。

---

### 4. 批处理滑块更改：`src/components/inspector/Inspector.jsx`

**导入**：
```javascript
import { beginBatch, endBatch } from '@/store/undoHistory';
```

**修改后的 SliderRow**：
```javascript
function SliderRow({ label, value, min, max, step = 1, onChange, help }) {
  return (
    <div
      className="space-y-1 py-0.5"
      onPointerDown={() => beginBatch(useProjectStore.getState().project)}
      onPointerUp={endBatch}
    >
      {/* Shadcn Slider component inside */}
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}
```

**效果**：
- 用户触碰滑块拇指 → `onPointerDown` 捕获一个快照
- 用户拖动滑块 → 快速 onChange 调用 → `updateProject` 看到 `isBatching() === true` → 跳过快照
- 用户松开滑块 → `onPointerUp` 结束批处理
- 结果：Ctrl+Z 跳转到拖动开始前的不透明度

**适用于**：
- 不透明度滑块
- 混合变形影响强度滑块
- 网格偏移滑块（变形器设置）

---

### 5. 批处理 Gizmo 拖动：`src/components/canvas/GizmoOverlay.jsx`

**导入**：
```javascript
import { beginBatch, endBatch } from '@/store/undoHistory';
```

**拖动处理器中的模式**（startMoveDrag、startRotateDrag、startPivotDrag）：
```javascript
const startMoveDrag = useCallback((e, nodeId) => {
  if (editorModeRef.current === 'staging') {
    beginBatch(useProjectStore.getState().project);
  }
  dragRef.current = { nodeId, startX: e.clientX, ... };
  
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
}, []);

const onDragMove = useCallback((e) => {
  // ... compute delta ...
  updateProject((proj) => {
    proj.nodes[nodeId].x += deltaX;
  }, { skipHistory: true });  // ← skipHistory: true
}, []);

const onDragEnd = useCallback(() => {
  endBatch();
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
}, []);
```

**效果**：
- 用户抓住 gizmo 手柄 → `beginBatch()` 捕获快照（仅 Staging 模式）
- Gizmo 拖动触发 60+ pointermove 事件 → 所有 `updateProject` 调用使用 `skipHistory: true` 并看到 `isBatching() === true` → 跳过快照
- 用户松开 → `endBatch()`
- 结果：Ctrl+Z 跳转到拖动前位置，而非中间位置

---

### 6. 批处理骨架拖动：`src/components/canvas/SkeletonOverlay.jsx`

**导入**：
```javascript
import { beginBatch, endBatch } from '@/store/undoHistory';
```

**拖动模式**：
```javascript
const onPointerDown = useCallback((e, nodeId) => {
  if (editorModeRef.current === 'staging') {
    beginBatch(useProjectStore.getState().project);
  }
  dragRef.current = { nodeId, startX: e.clientX, ... };
  
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}, []);

const onPointerMove = useCallback((e) => {
  const delta = e.clientX - dragRef.current.startX;
  updateProject((proj) => {
    proj.nodes[nodeId].transform.x += delta;
  }, { skipHistory: true });  // ← skipHistory: true
}, []);

const onPointerUp = useCallback(() => {
  endBatch();
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}, []);
```

**适用于**：
- 骨骼旋转拖动（触控板旋转、弧线手柄旋转）
- 骨骼位置拖动（骨架绑定）

---

### 7. 批处理时间轴拖动：`src/components/timeline/TimelinePanel.jsx`

**导入**：
```javascript
import { beginBatch, endBatch } from '@/store/undoHistory';
```

**关键帧拖动模式**（约第 790 行）：
```javascript
const onKeyframePointerDown = useCallback((e, nodeId, keyframeTime) => {
  beginBatch(useProjectStore.getState().project);
  dragRef.current = { nodeId, keyframeTime, startX: e.clientX };
  
  const handleMove = (moveEvent) => {
    const delta = moveEvent.clientX - dragRef.current.startX;
    updateProject((proj) => {
      // Move keyframe to new time
    }, { skipHistory: true });  // ← skipHistory: true
  };
  
  const handleUp = () => {
    endBatch();
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
  };
  
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
}, []);
```

**音频轨道拖动模式**：
```javascript
const handleBarDrag = (e) => {
  beginBatch(useProjectStore.getState().project);
  
  const handleMove = (moveEvent) => {
    const newStart = computeAudioStart(moveEvent);
    updateProject((proj) => {
      proj.audioTracks[trackId].startTime = newStart;
    }, { skipHistory: true });  // ← skipHistory: true
  };
  
  const handleUp = () => {
    endBatch();
    // cleanup
  };
  
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
};
```

---

## 遇到的问题及修复

### 问题 1：网格撤销故障（GPU 缓冲滞后）

**症状**：撤销网格变形（混合变形拖动、骨骼旋转）后，当用户选中或取消选中图层时，应用会在撤销后的状态（网格回到原始）与变形状态之间闪烁。

**根因**：GPU 缓冲同步存在一帧滞后。

流程为：
1. 用户撤销变形 → 项目状态回退（网格 UV 回到原始）
2. 以回退后的项目调用 `sceneRef.current.draw()`
3. 绘制命令使用**上一帧的 GPU 网格顶点**（仍是变形状态）
4. 绘制**完成后**，才调用 `sceneRef.current.parts.uploadPositions()`
5. GPU 缓冲现在有正确（未变形）顶点，但它们未用于本帧渲染
6. 下一帧以正确顶点渲染
7. 用户点击选中/取消选中图层 → 触发 dirty 标志 → 场景重新渲染
8. 现在渲染使用正确的 GPU 缓冲 → 图层看起来正常

闪烁就是：先用旧 GPU 缓冲渲染（变形），再用新缓冲渲染（未变形）。

**解决方案**：在 `src/components/canvas/CanvasViewport.jsx`（约第 341 行）中将 GPU 网格上传重排到绘制调用**之前**。

**修改前**：
```javascript
// Line 341 (rAF tick)
sceneRef.current.draw(...);
sceneRef.current.parts.uploadPositions();  // ← happens after draw
```

**修改后**：
```javascript
// Line 341 (rAF tick)
sceneRef.current.parts.uploadPositions();  // ← happens before draw
sceneRef.current.draw(...);
```

**效果**：GPU 缓冲与绘制调用在同一帧内同步。无单帧滞后，撤销时无闪烁。

---

### 问题 2：网格撤销后贴图不可见

**症状**：撤销网格变形时，整个图层变得不可见（看不到贴图，只能看到顶点和骨架）。保存并重新载入项目时，根本载入不了任何贴图 —— 除骨架叠加层外所有图层都不可见。

**根因**：快照序列化期间类型化数组损坏。

最初的 undoHistory.js 使用 `JSON.parse(JSON.stringify(project))` 生成快照：
```javascript
// BUGGY CODE:
export function pushSnapshot(project) {
  _snapshots.push(JSON.parse(JSON.stringify(project)));  // ← JSON doesn't preserve Float32Array
  // ...
}
```

当 Float32Array（用于网格 UV）被 JSON 序列化时：
```javascript
const uvs = new Float32Array([0.0, 0.0, 1.0, 1.0]);
JSON.stringify({ uvs });  // → {"uvs":{}}  (empty object!)
JSON.parse('{"uvs":{}}');  // → { uvs: {} }
```

撤销后，`node.mesh.uvs` 变成了空对象 `{}` 而非 Float32Array。贴图采样代码期望的是：
```javascript
// In shader/sampling code:
const u = uvs[index * 2];      // ← trying to index an object!
const v = uvs[index * 2 + 1];  // ← results in undefined
```

贴图坐标变为 undefined，贴图采样失败，图层变得不可见。

保存到文件时，空对象被写入磁盘。重新载入时没有可用的 UV 数据，贴图无法载入。

**解决方案**：将 `src/store/undoHistory.js` 中所有三处 `JSON.parse(JSON.stringify(...))` 调用替换为 `structuredClone(...)`：

```javascript
// Line 19 - pushSnapshot()
export function pushSnapshot(project) {
  _snapshots.push(structuredClone(project));  // ← preserves Float32Array
  if (_snapshots.length > MAX_HISTORY) _snapshots.shift();
  _redoStack = [];
}

// Line 58 - undo()
export function undo(currentProject, applyFn) {
  if (_snapshots.length === 0) return;
  const prev = _snapshots.pop();
  _redoStack.push(structuredClone(currentProject));  // ← preserves Float32Array
  applyFn(prev);
}

// Line 70 - redo()
export function redo(currentProject, applyFn) {
  if (_redoStack.length === 0) return;
  const next = _redoStack.pop();
  _snapshots.push(structuredClone(currentProject));  // ← preserves Float32Array
  applyFn(next);
}
```

**为何 structuredClone 可行**：
- 正确处理 Float32Array、Uint8Array、Set、Map、Date 及其他类型化数据
- 深克隆嵌套对象和数组
- 为循环引用保留对象标识
- 无 JSON 序列化 —— 没有可枚举属性的限制

**效果**：撤销/重做现在正确保留所有网格数据，贴图坐标保持有效，撤销后图层保持可见。

---

## 什么可撤销，什么不可撤销

| 操作 | 可撤销 | 机制 |
|-----------|----------|-----------|
| 变换（x、y、rotation、scale、pivot）—— NumericInput | 是 | 每次提交自动快照（失焦/Enter 时） |
| 不透明度、混合变形影响强度滑块 | 是 | 每次手势批处理 |
| 添加/删除混合变形 | 是 | 自动快照 |
| Gizmo 拖动（位置、旋转、缩放） | 是 | 每次手势批处理 |
| 骨架骨骼拖动 | 是 | 每次手势批处理 |
| 关键帧添加/删除 | 是 | 自动快照 |
| 关键帧拖动 | 是 | 每次手势批处理 |
| 音频轨道添加/裁剪/移动 | 是 | 每次手势批处理 |
| 网格生成 / 重网格 | 是 | 自动快照 |
| 组创建 / 重新设为子级 | 是 | 自动快照 |
| 载入项目 / 重置 | 否 —— 清除历史 | 载入时 `clearHistory()` |
| 草稿姿态更改（动画模式） | 否 —— draftPose 不在 project 中 | 仅 animationStore |
| 撤销/重做的应用本身 | 否 | `skipHistory: true` |
| 选择、缩放、平移（editorStore） | 否 | editorStore 未被触碰 |

---

## 开发者使用模式

### 添加新的可撤销操作

如果你向应用添加新的变更：

1. **确保它经过 `updateProject()`**：大多数变更已经如此。若非如此，重构为使用 updateProject。

   ```javascript
   // Good: auto-snapshots before mutation
   updateProject((proj) => {
     proj.nodes[nodeId].newProperty = value;
   });
   ```

2. **对于离散变更（NumericInput 提交、按钮点击）**：无需额外代码。updateProject 会自动快照。

3. **对于连续操作（拖动、滑块）**：用 beginBatch/endBatch 包裹。

   ```javascript
   onPointerDown: () => beginBatch(useProjectStore.getState().project),
   onPointerMove: () => updateProject(recipe, { skipHistory: true }),
   onPointerUp: () => endBatch(),
   ```

### 添加撤销 UI 指示器

要显示撤销/重做是否可用：

```javascript
// In a component:
const undoCount = useUndoHistoryStore?.((state) => state.undoCount);
const redoCount = useUndoHistoryStore?.((state) => state.redoCount);

// Currently: no UI store exposes undo/redo counts
// To add: export undoCount() and redoCount() from undoHistory.js
// Create a hook to expose these to React components
```

**注意**：当前实现未向 React 暴露 undoHistory store。如果你需要显示 “Undo disabled” / “Redo enabled” 的 UI 按钮，可以：
- 创建一个订阅历史模块的自定义 hook
- 或将 undoHistory.js 重构为 Zustand store，以与应用其余部分保持一致

---

## 验证清单

- [x] 基本撤销：更改一个变换字段（失焦以提交）→ Ctrl+Z → 值回退
- [x] 重做：撤销后 → Ctrl+Y → 值恢复
- [x] 滑块批处理：拖动不透明度滑块 —— Ctrl+Z 跳转到拖动开始前的不透明度
- [x] Gizmo 拖动批处理：在视口中拖动节点 —— Ctrl+Z 跳转到拖动前位置
- [x] 关键帧批处理：在时间轴中拖动关键帧 —— Ctrl+Z 恢复到拖动前的帧
- [x] 栈限制：进行 55 次更改 —— 验证历史中仅有 50 条（最旧的被丢弃）
- [x] 载入清除历史：载入项目 → Ctrl+Z 无反应（历史被清除）
- [x] 网格变形撤销：拖动骨骼/混合变形，撤销 → 网格变形回退（无闪烁）
- [x] 贴图保留：网格撤销后，贴图保持可见且正确

---

## 测试

### 单元测试机会

如果你添加测试，可考虑：

1. **pushSnapshot/undo/redo 循环**：
   ```javascript
   // Snapshot a project, mutate it, undo, verify state reverts
   const orig = { nodes: { n1: { x: 0 } } };
   pushSnapshot(orig);
   const mutated = { nodes: { n1: { x: 100 } } };
   undo(mutated, (snap) => {
     assert(snap.nodes.n1.x === 0);
   });
   ```

2. **批处理隔离**：
   ```javascript
   // Three updates in batch should produce only one snapshot
   beginBatch(project);
   updateProject(recipe1);
   updateProject(recipe2);
   updateProject(recipe3);
   endBatch();
   assert(undoCount() === 1);  // One snapshot, not three
   ```

3. **Float32Array 保留**：
   ```javascript
   // Snapshot with Float32Array, undo, verify array type preserved
   const proj = { mesh: { uvs: new Float32Array([0, 1, 2, 3]) } };
   pushSnapshot(proj);
   undo(mutated, (snap) => {
     assert(snap.mesh.uvs instanceof Float32Array);
     assert(snap.mesh.uvs[0] === 0);
   });
   ```

### 手动测试场景

1. **变换撤销**：X/Y/旋转的 NumericInput → 按 Tab/Enter → Ctrl+Z → 值回退
2. **多步撤销**：进行 5 次更改（每次离散）→ 按 5 次 Ctrl+Z → 回到起点
3. **滑块撤销**：抓住不透明度滑块，拖过整个范围 → 松开 → Ctrl+Z → 拖动前的不透明度
4. **复杂拖动**：在视口中，通过 gizmo 拖动节点 + 旋转 + 缩放 → 松开 → Ctrl+Z → 全部回退
5. **撤销后重做**：更改值 → 撤销 → 重做 → 值恢复
6. **重做失效**：更改 → 撤销 → 进行新更改 → Ctrl+Y 无反应（重做栈被清空）
7. **动画模式隔离**：在动画模式中，拖动调整 draftPose → Ctrl+Z 无反应（draftPose 不在 project 中）

---

## 已知局限与未来工作

### 当前局限

1. **无撤销/重做计数的 UI**：键盘处理器工作正常（Ctrl+Z/Y），但没有 UI 按钮显示 “Undo disabled” 状态。
   - **未来**：从 undoHistory.js 导出 undoCount/redoCount，创建 hook，添加工具栏按钮。

2. **陈旧快照无 “undo” 指示器**：载入项目后历史被清除。无视觉反馈。
   - **未来**：项目载入时显示 “History cleared” toast 通知。

3. **历史不跨会话持久化**：撤销历史仅在内存中，页面刷新后丢失。
   - **当前为设计使然**：快照是完整项目克隆（50 * ~1MB = 50MB 占用）。持久化不切实际。
   - **未来**：可选的 IndexedDB 持久化，带可配置的最大体积。

4. **无分组撤销**：多个相关更改（例如 “添加混合变形 + 设置影响强度”）会创建单独的历史条目。
   - **未来**：添加 `groupUndoStart()` / `groupUndoEnd()` API 以批处理逻辑相关的更新。

### 未来增强

- [ ] 带启用/禁用状态的撤销/重做 UI 按钮
- [ ] 历史达到上限时的 toast 通知
- [ ] 撤销历史侧边栏（显示先前的状态）
- [ ] 可选的历史 IndexedDB 持久化
- [ ] 分组撤销（将多个更新批处理为一个历史条目）
- [ ] 撤销差异可视化（显示更改内容）

---

## 技术说明

### 为什么用 structuredClone 而非 JSON？

```javascript
// JSON doesn't preserve typed arrays:
const uvs = new Float32Array([0, 1, 2, 3]);
const json = JSON.stringify({ uvs });           // → '{"uvs":{}}'
const restored = JSON.parse(json);
restored.uvs instanceof Float32Array;           // → false
restored.uvs[0];                                // → undefined

// structuredClone preserves them:
const clone = structuredClone({ uvs });
clone.uvs instanceof Float32Array;              // → true
clone.uvs[0];                                   // → 0
```

**代价**：对于可序列化数据，structuredClone 比 JSON 略慢，但能正确处理所有 JS 类型。鉴于快照在离散变更时捕获（而非每帧），性能影响可忽略。

### 为什么 updateProject 中要有 isBatching 检查？

没有批处理检查，拖动期间每次指针移动都会推入一个快照：
```javascript
// Slider drag (60 FPS):
onPointerDown → snapshot #1
onChange → snapshot #2
onChange → snapshot #3
onChange → snapshot #4
... (58 more snapshots)
onPointerUp → done
// History now has 60 entries for a single slider gesture!
```

有了批处理：
```javascript
onPointerDown → snapshot #1, _batchDepth = 1
onChange → isBatching() = true → skip snapshot
onChange → isBatching() = true → skip snapshot
... (58 more skipped)
onPointerUp → _batchDepth = 0
// History has 1 entry for the entire gesture
```

### 为什么需要单独的 skipHistory 参数？

在应用撤销/重做时，我们调用 `updateProject(recipe, { skipHistory: true })`。这防止撤销的应用本身推入另一个快照。

没有它：
```javascript
// User presses Ctrl+Z
undo(currentProject, (snapshot) => {
  updateProject((proj) => {
    Object.assign(proj, snapshot);  // ← missing { skipHistory: true }
  });
});

// Flow:
// 1. updateProject sees mutation
// 2. Checks: not batching, skipHistory = false
// 3. Pushes current state to _snapshots (the state we're trying to undo!)
// 4. Applies recipe
// 5. Result: We pushed the "after" state, then jumped back to "before"
//    Pressing undo again would just redo it — infinite loop
```

使用 `skipHistory: true` 时，撤销的应用本身不会快照，从而保留历史链。

---

## 文件摘要

| 文件 | 类型 | 更改 | 行数 |
|------|------|---------|-------|
| undoHistory.js | 新建 | 历史栈、批处理逻辑、快照/撤销/重做函数 | 81 |
| projectStore.js | 修改 | 从 undoHistory 导入，向 updateProject 添加 skipHistory 参数，clearHistory 调用 | ~20 |
| useUndoRedo.js | 重写 | 使用 undoHistory 模块，Ctrl+Z/Y 的键盘处理器 | ~50 |
| Inspector.jsx | 修改 | 导入 beginBatch/endBatch，用批处理包裹 SliderRow | ~5 |
| GizmoOverlay.jsx | 修改 | 导入 beginBatch/endBatch，批处理拖动操作 | ~10 |
| SkeletonOverlay.jsx | 修改 | 导入 beginBatch/endBatch，批处理骨骼旋转/位置拖动 | ~10 |
| TimelinePanel.jsx | 修改 | 导入 beginBatch/endBatch，批处理关键帧和音频拖动 | ~15 |
| CanvasViewport.jsx | 修改 | 将 GPU 网格上传重排到绘制前（修复 GPU 缓冲滞后） | 1 |

**总新增**：~170 行  
**总修改**：~60 行  
**总修复 Bug**：2（GPU 缓冲滞后、类型化数组序列化）

---

## 参考

- [MDN: structuredClone()](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone)
- [MDN: Float32Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float32Array)
- [Immer Draft Objects](https://immerjs.github.io/immer/)
- [Zustand State Management](https://github.com/pmndrs/zustand)
- [Stretchy Studio Architecture](../README.md)

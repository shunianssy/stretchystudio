# Stretchy Studio —— 项目概览与状态

**最后更新：** 2026-04-12 · **当前阶段：** M6 保存/载入项目 · **下一阶段：** M7 精灵表导出

---

## 1. 项目愿景

Stretchy Studio 是一款面向插画师和动画师的 2D 动画工具。导入 PSD/PNG → 将图层分组 → 在 After Effects 风格的时间轴上摆姿势 → 导出精灵表。简单、直观、端到端的工作流程。

**核心设计原则：** 交付薄的垂直切片。每个里程碑都让应用保持端到端可用。

### 与原计划的差异

原设计倾向于 Live2D 风格的参数和抽象变形器（复杂的 UX）。修订后的方法以**时间轴优先**：
- 完全放弃参数系统
- 直接为变换和网格顶点制作关键帧
- After Effects 工作流程（而非 Live2D）
- 对 2D 动画师而言学习门槛更低

---

## 2. 架构

### 目录布局

```
src/
  app/layout/              # 4-zone layout (canvas, layers, inspector, timeline)
  store/
    projectStore.js        # Scene tree (Nodes, Groups, Parts) + project state
    editorStore.js         # Selection, tool mode, viewport state
    animationStore.js      # [M4] CurrentTime, isPlaying, poseOverrides
    historyStore.js        # Undo/redo (skeleton, not yet integrated)
  renderer/
    transforms.js          # [M3] Matrix math & world matrix composition
    scenePass.js           # Transform pass + draw pass (hierarchical MVP)
    partRenderer.js        # VAO per part, vertex/UV/index management
    program.js, shaders/   # WebGL shader programs
  mesh/
    contour.js, sample.js, delaunay.js, generate.js, worker.js
  components/
    canvas/
      CanvasViewport.jsx   # Viewport + drag-drop, PSD auto-org modal
      GizmoOverlay.jsx     # [M3] Transform gizmo (move + rotate handles)
    layers/
      LayerPanel.jsx       # [M3] DRAW ORDER & Groups tabs, drag-to-reparent
    inspector/
      Inspector.jsx        # [M3] Transform panel + mesh settings
    timeline/              # [M4] TrackRows, Keyframes, Playhead
  io/
    psd.js                 # ag-psd wrapper for layer extraction
    psdOrganizer.js        # [M3] Character format detection & auto-grouping
    export.js              # [M5] Spritesheet/Zip builder
```

### 数据模型

```
Project
├── nodes: [
│   { id, type: 'part' | 'group', name, parent, visible, opacity },
│   { transform: {x, y, rotation, scaleX, scaleY, pivotX, pivotY} },
│   { draw_order (parts only) },
│   { mesh, meshOpts (parts only) }
│ ]
├── textures: { [nodeId]: blobUrl }
├── activeAnimationId: uuid (M4+)
└── animations: [{ id, name, duration, fps, tracks: [...] }] (M4+)
```

### 渲染管线

1. **变换处理**（深度优先树遍历）：
   - 计算世界矩阵：`parent.world × node.local`
   - 为每个节点存储瞬时的 `node._worldMatrix`
2. **绘制处理**（按 `draw_order` 排序）：
   - 每个部件的 MVP = camera × worldMatrix
   - 渲染网格、线框、顶点、叠加层
   - 遵循 `visibility` 和 `opacity`

---

## 3. 已完成的里程碑

### ✅ M1 —— 画布基础（已完成）
- 每个部件带 VAO 的 WebGL2 渲染器骨架
- PNG 单图层导入与自动三角剖分
- 带撤销/重做的顶点拖动
- 基础视口缩放/平移

### ✅ M2 —— 自动网格与 PSD 导入（已完成）
- **PSD 导入**（`ag-psd` 封装）：多图层提取、保留图层名称、正确的 z 顺序
- **网格生成滑块**：透明度阈值、平滑次数、网格间距、边缘留白、边缘点数
- **按部件网格覆盖**：每个图层可自定义网格设置
- **视口导航**：朝光标缩放、Alt+拖动平移、平滑控制
- **手动网格编辑**：添加/删除顶点工具（在重网格前不自动重新三角剖分）
- **Layer Panel v1**：名称、绘制顺序重排按钮
- **可见性叠加层**：图像、线框、顶点、边缘轮廓的全局开关
- **Inspector 面板**：叠加层开关、工具模式按钮、网格设置、按部件不透明度

### ✅ M3 —— 组与层级变换（完成于 2026-04-08）
- **矩阵数学库**（`src/renderer/transforms.js`）：3×3 仿射数学、世界矩阵复合
- **场景图**：带变换继承的组节点、`reparentNode` 操作
- **变换 Gizmo**（`GizmoOverlay.jsx`）：画布上的拖动移动手柄（平移）+ 旋转弧线手柄
- **变换 Inspector**：X、Y、Rotation (°)、Scale (%)、Pivot 的数字输入
- **Layer Panel 标签页**：
  - **DRAW ORDER 标签页**：带组名 chip 的扁平 draw_order 列表，拖动重排（挤压行为），右键上下文菜单
  - **Groups 标签页**：树视图，拖动重新设为子级，可折叠组，选中时自动展开
- **PSD 自动组织器**（`psdOrganizer.js`）：
  - **角色格式检测**：若 ≥4 个图层名称匹配 23 个已识别角色标签库（例如 brow、iris、neckwear、topwear、footwear）则触发。
  - **层级分组**：自动将图层嵌套进结构化的 **Head**（含 **Eyes** 子组）、**Body**（含 **Upperbody** 和 **Lowerbody**）和 **Extras** 层级。
  - **保留的绘制顺序**：确保在新组结构内保持原始 PSD 图层深度，尊重画师的手动排序。
- **渲染器集成**：按部件世界矩阵，层级变换端到端工作
- **网格生成精化**（`src/mesh/contour.js`、`src/mesh/generate.js`）：
  - **多种子轮廓追踪**：独立追踪所有分离区域（眼、手臂等），而不仅是第一个
  - **边界膨胀**：边缘顶点放置在视觉边界外 2px → 网格覆盖完整图像内容 → 贴图 alpha 提供视觉裁剪
  - **按轮廓顶点分配**：按周长在检测到的所有区域间按比例分配 `numEdgePoints`
- **虹膜裁剪**（`src/renderer/scenePass.js`）：
  - **基于模板（Stencil）的遮罩**：虹膜自动裁剪到各自对应的眼白图层。
  - **左右匹配**：使用名称后缀正确将 `irides-l` 匹配到 `eyewhite-l`（以及 -r/-r），以处理拆分眼睛的角色。
  - **Alpha 感知遮罩**：使用着色器级 `discard` 确保裁剪遵循眼白的视觉形状，即使是无网格的四边形部件。
- **修复的 Bug**：PSD 不透明度（曾为 0）、网格生成（并发 worker）、图层渲染顺序、深度标签页拖动行为、网格裁剪（弦捷径效应）、多部件边缘点覆盖

**达成的退出标准：** 创建组 → 将图层设为子级 → 旋转组 → 子级围绕轴心旋转。深度标签页不变。Groups 标签页拖动重新设为子级而不影响 draw_order。网格现在覆盖外部区域且无裁剪；多个分离部件都获得适当的边缘点覆盖。

**M3 精化（按需网格架构）：**
- **移除自动网格：** 图层导入时不再生成网格。图层以带贴图的四边形渲染，直到用户在 Inspector 中显式点击 “Generate Mesh”。
- **基于 Alpha 的选择：** 图层选择现在使用 alpha 通道采样而非网格相交。对无网格部件有效；当网格存在时顶点邻近检查仍然有效。
- **裁剪包围盒：** 无网格部件的 Gizmo 包围盒现在裁剪到实际不透明像素（导入时计算一次），而非完整图像边界。
- **回退四边形渲染：** 每个部件获得一个简单的 2 三角形四边形 VAO 用于无网格贴图渲染。当用户生成网格后由实际网格替换。
- **Inspector 更改：**
  - 无网格时显示 “Generate Mesh” 按钮；有网格时显示 “Remesh” 按钮
  - “Delete Mesh” 选项以回退到四边形回退
  - 网格设置在生成前仍可访问以进行预配置
- **收益：** 更快的导入（无网格生成）、更干净的工作流程（网格作为可选）、更低的内存占用、更利于 M4 动画管线（无需密集顶点数据即可更轻松地关键帧）

---

## 4. 即将到来的里程碑

### ✅ M4 —— 时间轴与动画管理（完成于 2026-04-11）
- **编辑器模式切换**：`Staging`（M3 设置）| `Animation`（M4 时间轴）模式。切换位于画布左上角。
- **时间轴交互引擎**：
  - **可拖动关键帧**：左键单击并拖动菱形标记以调整时序；吸附到整数帧。
  - **多选与框选**：Shift+单击切换，或在轨道背景中拖动选择框以选择成组关键帧。
  - **成组移动**：一次移动多个选中的关键帧，保留相对时序。
  - **剪贴板（Ctrl+C/V）**：跨不同节点或不同时间复制粘贴关键帧。
  - **删除**：支持 `Backspace`/`Delete` 进行成组移除。
- **动画管理面板**：
  - **新侧边栏区域**：右侧边栏 Inspector 下方的专用 “Animations” 面板。
  - **CRUD 操作**：创建新片段、切换活动片段（自动重置播放头）、用编辑铅笔图标重命名、用确认弹窗删除。
- **标尺与循环处理**：
  - **可拖动循环标记**：标尺包含 Start 和 End 标志，以可视地定义循环范围。
  - **传输控制**：Play/Pause/Stop/Loop 切换，带数字 FPS 和当前帧字段。
- **播放与插值**： 
  - 由 rAF 循环驱动的平滑变换 lerp。
  - 动画属性通过 `poseOverrides` 映射与基础节点状态分离。
- **基于模式的 UI 持久化**：时间轴和动画面板在 `Staging` 模式中自动隐藏，以保持网格设置工作区整洁。
- **UI UX 打磨**：Alt+Scroll 水平缩放，原生溢出用于平移。

**达成的退出标准：** 用户可以导入 PSD、设置组、切换到 Animation 模式、创建多个片段（“Idle”、“Walk”）、用可拖动关键帧摆姿势、在节点间复制粘贴姿势，并平滑循环回放。

---

### ✅ M5 —— 骨架自动绑定与骨骼动画（完成于 2026-04-12）
 
 **目标：** 通过启发式和 AI 驱动的骨架检测，为 vtuber 风格动画启用 see-through PSD 角色的绑定。

 - **PSD 导入向导**（2026-04-12 添加）：
   - **3 步流程**：选择绑定方法 → 载入/估算骨架 → 在提交前于画布上调整关节
   - **步骤 1（选择）**：用户选择：
     - *Rig manually*：从图层包围盒快速启发式生成骨架（无下载）
     - *Rig with DWPose*：高精度 AI 姿态检测（约 50MB 模型）
     - *Skip rigging*：平铺导入，无骨架
   - **步骤 2（载入/估算）**： 
     - 手动路径：通过 `estimateSkeletonFromBounds()` 即时估算骨架
     - DWPose 路径：显示模型状态，上传 .onnx 或从 HuggingFace 下载
   - **步骤 3（调整）**：带浮动工具栏的全画布关节调整
     - 可拖动的黄色关节圆圈以重新定位骨架
     - Back 按钮：回退项目快照，返回选择步骤（在 Finish 前的任意时刻）
     - Finish 按钮：提交绑定并关闭向导

 - **启发式骨架估算**（`src/io/armatureOrganizer.js`，新增 `estimateSkeletonFromBounds`）：
   - 将图层包围盒映射到关键点：头部来自 `face`/`front hair` 边界，肩部来自 `topwear`，手臂/腿部进行插值
   - 若缺少图层则回退到合理的默认值
   - 零外部依赖；导入时即时运行

 - **DWPose ONNX 集成**（`src/io/armatureOrganizer.js`）：
   - 从 HuggingFace CDN 载入并缓存 DWPose 会话（dw-ll_ucoco_384.onnx）
   - 133 关键点姿态检测，使用 SimCC 输出格式
   - 关键点映射到角色骨架：颈部、腰部、肩部中点、肢体关节（肘/膝）

- **肢体弯曲与顶点蒙皮**（2026-04-12 添加）：
  - **轴感知权重**：肢体图层（手臂/腿部）中的顶点通过将其投影到肩-肘或髋-膝轴来自动分配权重。 
  - **JS 驱动蒙皮**：肘部和膝盖旋转通过 `SkeletonOverlay.jsx` 中自定义蒙皮引擎实时局部变形网格顶点。
  - **自动关键帧**：为肢体关节制作关键帧会自动捕获关联部件的变形后顶点位置。
   
 - **骨架节点构建器**：
  - 创建层级骨骼结构：`root → torso → head → eyes`、`root → [left/right]Leg → [left/right]Knee`、`torso → [left/right]Arm → [left/right]Elbow`
   - 所有骨骼都是带 `boneRole` 属性的组节点
   - 关节位置存储为 `transform.pivotX/Y`（无需新的数据类型）
   
 - **骨架叠加层与变形**（`src/components/canvas/SkeletonOverlay.jsx`）：
   - 显示骨骼线（青色）和关节圆圈的 SVG 叠加层
   - **骨架编辑模式**（仅 Staging）：
     - 可拖动的关节点以重新定位骨骼轴心
     - 单击关节圆圈选择骨骼 → 出现 GizmoOverlay 以进行微调
     - 在动画模式中：旋转写入 draftPose；按 K 制作关键帧
     - **肢体旋转手柄**：肘部和膝盖处的琥珀色弧线触发 JS 驱动的顶点变形。
     - **蒙皮提交**：在 Staging 模式中，肢体旋转在松开时直接将变形后的顶点提交到基础网格。
   - **2D 虹膜触控板**（2026-04-11 添加）：
     - 专用于 `eyes` 骨骼的 80x80px 方形触控板
     - 定位在头部上方 -120px，以保持表情的清晰视图
 
 **达成的退出标准：** 
 - 导入 see-through PSD → 出现 3 步导入向导
 - **手动路径**：选择 “Rig manually” → 即时估算骨架 → 在画布上调整关节 → Finish
 - **DWPose 路径**：选择 “Rig with DWPose” → 下载/上传模型 → DWPose 运行 → 调整关节 → Finish
 - **随时返回**：在调整步骤点击 Back → 项目回退到绑定前状态，向导在选择步骤重新打开
 - **动画**：切换到动画模式 → 拖动弧线 + 按 K 制作关键帧 → 刮擦时间轴 → 角色随骨骼旋转和平滑肢体弯曲动画

**关键设计决策：**
- 骨骼就是组节点（无新结构），轴心就是关节位置（无额外字段）
- 启发式绑定无需外部依赖；网络不可用时很有用
- 单个 ONNX 会话缓存于模块级，以避免重复下载
- 每帧在 SkeletonOverlay 中重新计算世界矩阵，以正确处理动画状态
- 项目快照启用 Back 功能：在 finalizePsdImport 前保存快照，点击 Back 按钮时恢复
- 调整步骤使用浮动工具栏（非模态），在关节微调期间保持画布实时可交互

---

### ✅ M6 —— 保存/载入项目（.stretch 格式）（完成于 2026-04-12）

**目标：** 启用持久化项目存储，使用户可以保存作品并稍后重新载入。

**实现：**
- **.stretch 文件格式**：包含 project.json + 带 PNG 文件的 textures/ 文件夹的 ZIP 归档
- **UI 按钮**：画布左上角工具栏中的 Download（💾）和 Upload（📁）图标
- **序列化**（`src/io/projectFile.js`）：
  - `saveProject(project)` → 从 blob URL 获取贴图，导出为带相对贴图路径的 ZIP
  - `loadProject(file)` → 读取 ZIP、解析 project.json、载入 PNG 贴图、恢复类型化数组（Float32Array、Set）
- **Store 集成**（`src/store/projectStore.js`）：
  - `loadProject(projectData)` 操作替换整个项目状态并递增版本计数器
- **GPU 重新上传**（`CanvasViewport.jsx`）：
  - 用 `destroyAll()` 清除旧 GPU 资源
  - 为基于 alpha 的拾取重建 `imageDataMapRef`
  - 用 `uploadTexture()` 重新上传贴图
  - 用 `uploadMesh()` 或 `uploadQuadFallback()` 恢复网格
  - 重置编辑器选择和动画播放状态

**会被保存的内容：**
- ✅ 画布尺寸、节点层级（部件 + 组）
- ✅ 图层名称、可见性、不透明度、变换（位置、旋转、缩放、轴心）
- ✅ 网格几何（顶点、三角形、UV、边缘索引）+ 网格设置
- ✅ 包围盒（imageBounds、imageWidth、imageHeight）
- ✅ 骨架绑定（boneRole、skinWeights）
- ✅ 所有贴图，作为 PNG 文件
- ✅ 所有动画（片段、关键帧、缓动，包括 mesh_verts 变形）

**不会被保存的内容：**
- ❌ 编辑器状态（选择、工具模式、视口缩放/平移）
- ❌ 动画播放状态（currentTime、isPlaying）
- ❌ 草稿姿态（未提交的编辑）
- ❌ 撤销/重做历史

**类型转换：**
- `Float32Array` (mesh.uvs) → 保存时为 JSON Array，载入时恢复
- `Set` (mesh.edgeIndices) → 保存时为 JSON Array，保持为 Array（渲染器两者均可处理）
- Blob URL（贴图）→ 保存时为 ZIP 中的 PNG 文件，载入时为新的 blob URL
- `ImageData`（拾取）→ 不存储，载入时从贴图重新计算

**达成的退出标准：**
- ✅ 保存项目 → `.stretch` 文件以有效 ZIP 结构下载
- ✅ 载入项目 → 所有图层以正确层级和变换渲染
- ✅ 载入项目 → 网格 + mesh_verts 关键帧正确插值
- ✅ 载入项目 → 骨架动画随骨骼旋转回放
- ✅ 载入项目 → 编辑器功能（拾取、gizmo、网格编辑）立即可用

**文件格式细节：**
完整 schema、错误处理和性能特征请参阅 `docs/save_load_implementation.md`。

**性能：**
- 保存时间：200–500ms（贴图 fetch + ZIP 压缩）
- 载入时间：500ms–2s（ZIP 读取 + PNG 解码 + GPU 上传）
- 文件大小：base64-JSON 方法的 40–60%

---

### M7 —— 精灵表导出
- **GIF**：`gif.js` worker
- 打包的透明帧（PNG/WEBP）
- **WebM**：画布流上的 MediaRecorder API
- 基于 M6 的帧渲染器构建

---

## 5. 从原计划中放弃的内容

| 功能 | 状态 | 原因 |
|---------|--------|--------|
| 参数系统 | **放弃** | 由直接关键帧替代（学习门槛更低） |
| 武装录制模式 | **放弃** | 参数系统的一部分 |
| 弯曲变形器 5×5 网格 | **放弃** | 直接顶点关键帧更灵活且直观 |
| 路径变形器 | **放弃** | 范围缩减 |
| `.stretch` 格式 + 图集打包器 | **推迟** | 精灵表导出覆盖了眼前需求 |
| 2D 参数网格 | **放弃** | 超出范围 |
| 独立播放器库 | **推迟** | 无眼前用例 |

---

## 6. 关键架构说明

### 带四边形回退的按需网格
- **导入时不自动网格：** 部件初始以简单的 2 三角形带贴图四边形渲染（`uploadQuadFallback`）。网格生成无 GPU 开销。
- **惰性网格生成：** 用户在 Inspector 中点击 “Generate Mesh” → `dispatchMeshWorker` 计算网格 → `uploadMesh` 用实际网格替换四边形。
- **删除回退：** 用户点击 “Delete Mesh” → `uploadQuadFallback` 恢复四边形，`node.mesh = null`。
- **四边形无边缘：** 回退四边形的边缘索引为空（无绿色线框可视化）。一旦生成网格，边缘显示。

### 基于 Alpha 的选择（M3 精化）
- **ImageData 缓存：** 导入期间每个部件的 `ImageData` 存储在 `imageDataMapRef` 中，以便快速 alpha 采样。
- **边界计算：** `computeImageBounds(imageData)` 扫描不透明像素（alpha > 10），返回 `{minX, minY, maxX, maxY}`。缓存于节点为 `imageBounds`。
- **点击处理：** `sampleAlpha(imageData, lx, ly)` 返回像素处的 alpha。命中测试循环检查 alpha（无需网格）。当网格存在时顶点邻近检查仍然有效。
- **Gizmo 包围盒：** 无网格部件使用 `node.imageBounds`，有网格部件使用 `node.mesh.vertices`。

### 姿态分离
播放期间，插值后的值进入 `animationStore.poseOverrides`（一个 `nodeId → {x, y, rotation, ...}` 的 Map）。渲染器读取覆盖值而非 `projectStore` 值。这避免了用播放状态污染项目模型。

### 网格弯曲关键帧
存储为顶点位置的 `Float32Array` 快照。播放期间逐顶点 lerp。渲染器的 `PartRenderer.uploadPositions()` 热路径每帧更新 GPU 缓冲。

### 变换复合
每帧从节点树 + 姿态覆盖计算世界矩阵。M3 中无缓存（简单场景工作良好）。若性能需要，可在 M4+ 中添加缓存。

### 状态管理
- `projectStore`：持久化项目模型（节点、变换、贴图）。**新字段：** 无网格部件的 `imageWidth`、`imageHeight`、`imageBounds`。
- `editorStore`：UI 状态（选择、工具模式、视口、activeLayerTab）
- `animationStore`：播放状态（currentTime、isPlaying、poseOverrides）—— 分离以保持关注点隔离
- `historyStore`：撤销/重做骨架（尚未集成到 UI 工作流程中）

---

## 7. 当前项目统计

| 指标 | 值 |
|--------|-------|
| **状态** | M6 完成（保存/载入 .stretch 格式）；M7 精灵表导出处于设计阶段 |
| **修改/新建文件数** | 25+（新增：projectFile.js + 保存/载入处理器；修改：projectStore.js、CanvasViewport.jsx） |
| **行数**（核心） | ~4900（渲染器 + store + UI + 动画 + 骨架 + io + 序列化） |
| **打包体积** | 1.08 MB 压缩后，327 KB gzip 后（含 onnxruntime-web WASM；JSZip ~17 KB） |
| **性能** | 带绑定角色 + 动画时 60 fps；保存：200–500ms；载入：500ms–2s |
| **主要依赖** | ag-psd (~120 KB)、onnxruntime-web (~25 MB WASM)、jszip (^3.10.1)、WebGL2 |
| **导入/导出速度** | 手动绑定：即时；DWPose 绑定：~2–3s；项目保存：~300ms；项目载入：~1s |

---

## 8. 已知局限

- **尚无撤销/重做：** 所有更改即时生效（M5 功能）
- **无层级可见性剔除：** 隐藏父级的子级仍参与拾取（次要）
- **无变换继承预览：** Gizmo 仅显示局部轴
- **组无视觉外观：** 仅作为容器（有意为之；可能在 M5+ 重新考虑）
- **重网格滞后：** 大图像（>2048px）可能使 UI 冻结约 500ms（按规格可接受）
- **PSD 边缘情况：** CMYK、智能对象、图层效果、复杂混合模式未完全验证
- **网格膨胀：** 边缘顶点放置在 alpha 边界外 2px 以覆盖弦捷径。极细特征（<4px）可能在贴图 alpha 裁剪前略微延伸到视觉边界外（为可靠的全图像覆盖而接受此权衡）
- **边界计算：** 基于 alpha 的包围盒在导入时计算一次（阈值 = 10）。非常淡的半透明边缘可能被排除。有需要时可在未来精化。

---

## 8b. 已修复的 M4 动画 Bug

### 问题：笔刷变形与图层选择在动画节点上失败
**根因：** 在 `CanvasViewport.onPointerDown` 中，世界矩阵是从 `proj.nodes`（原始存储的变换）而非有效变换（关键帧插值 + 草稿姿态覆盖）计算的。这使得 `iwm`（逆世界矩阵）对任何应用了动画的节点都是错误的，破坏了：
1. **笔刷命中测试：** 笔刷无法在动画网格上选择/变形顶点
2. **图层选择：** 无法点击已被关键帧移动的部件（必须点击原始位置）
3. **顶点拾取：** 单顶点拖动无法在动画节点上注册

**修复：** 在 `onPointerDown` 开始时，通过将动画覆盖（关键帧值 + 草稿姿态）合并进基础节点变换来构建 `effectiveNodes`。从 `effectiveNodes` 而非原始 `proj.nodes` 计算 `worldMatrices` 和 `sortedParts`。这确保：
- `iwm` 将鼠标坐标转换到正确的局部空间（视觉实际所在处）
- 顶点拾取使用有效顶点位置（draft mesh_verts → keyframe mesh_verts → base mesh）
- 图层基于 alpha 的选择命中动画后的包围盒

**代码位置：** `src/components/canvas/CanvasViewport.jsx`，第 ~668–693 行（effectiveNodes 构建）及第 ~820–845 行（顶点拾取）。

### 问题：网格变形关键帧烘焙了基础网格
**根因：** 笔刷拖动总是调用 `updateProject`，无论动画模式如何，都直接将变形后的顶点写入 `node.mesh.vertices`（基础网格）。按 K 随后捕获的是已修改的基础网格，而非关键帧增量。

**修复：** 在动画模式 + 变形子模式下，笔刷拖动写入 `animRef.current.setDraftPose(partId, { mesh_verts })`，而非调用 `updateProject`。草稿姿态在渲染和拾取期间叠加在关键帧值之上。按下 K 时，读取有效顶点（draft → keyframe → base）并作为关键帧插入。随后 `clearDraftPoseForNode` 将视觉回退到关键帧值。刮擦或停止会清除所有草稿。

**代码位置：** `src/components/canvas/CanvasViewport.jsx`，第 ~876–885 行（笔刷拖动改道）。

### 问题：组层级关键帧被全局应用
**根因：** 当父组在第 1 帧有关键帧，而子级在第 12 帧有自己的关键帧时，子级的初始位置（第 0–11 帧）会吸附以匹配父级关键帧，而非平滑继承。这是因为未捕获静止姿态。

**修复：** 进入动画模式时添加 `captureRestPose(nodes)` 调用（M4 未来工作）。将未修改的节点变换存储在 `animationStore.restPose` 中。当为某个轨道插入超出 `startFrame` 的第一个关键帧时，自动在 `startFrame` 插入静止姿态值。这确保从第 0 帧起插值与组层级正确配合 —— 子级继承其基础位置，直到自己的关键帧生效。

**代码位置：** `src/renderer/animationEngine.js`（静止姿态逻辑）、`src/store/animationStore.js`（captureRestPose 操作）、`src/components/canvas/CanvasViewport.jsx`（K 处理器，第 ~297–303 行）。

---

## 9. 测试清单

✅ PNG 导入 → 单图层无网格渲染（四边形回退）  
✅ PSD 导入 → 所有图层带正确名称与 z 顺序，默认无网格  
✅ 角色格式检测 → 自动创建 Head（含 Eyes）、Body（含 Upper/Lowerbody）和 Extras 组，同时保留原始绘制顺序  
✅ 组创建 → 带默认变换的新组节点  
✅ 变换 gizmo → 拖动移动/旋转手柄；包围盒裁剪到不透明像素  
✅ Inspector 数字输入 → 画布实时更新  
✅ DRAW ORDER 标签页拖动 → 按 draw_order 重排（挤压行为）  
✅ Groups 标签页拖动 → 重新设为子级（仅改变 parent）  
✅ 可见性切换 → 按节点显示/隐藏（仅 Inspector）  
✅ 图层选择 → 基于 alpha 的拾取（无需网格即可工作）  
✅ Generate Mesh 按钮 → 创建网格，按钮变为 “Remesh”  
✅ Delete Mesh 按钮 → 移除网格，回退到四边形回退  
✅ 添加/删除顶点 → 需要网格；在已变换部件上进行正确的世界空间拾取  
✅ 顶点拖动 → 在局部空间中移动，同时跟踪世界运动  
✅ Gizmo 包围盒 → 无网格部件匹配不透明像素，有网格部件匹配网格顶点  

---

## 10. 后续步骤

1. **M7 精灵表导出**（下个冲刺）：
   - 帧捕获循环（离屏 WebGL 画布，每帧 gl.readPixels）
   - 精灵表打包（shelf-pack 到 2 的幂图集）
   - 导出设置 UI（动画片段下拉、FPS 覆盖、背景切换）
   - Zip 输出或精灵表 + JSON 图集（兼容 Phaser/Unity/Godot）

2. **M8+ 高级**：
   - 物理模拟（头发/衣物的弹性链）
   - GIF/视频导出
   - 撤销/重做集成
   - 混合模式、裁剪遮罩

---

**项目负责人：** Nguyen Phan  
**质量：** M6 完成（保存/载入端到端工作）；架构稳固，可推进 M7+

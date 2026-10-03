# 弯曲变形器实现

本文档描述 Stretchy Studio 中的原生弯曲变形器系统 —— 其当前架构、每条导出路径中已接入与未接入的内容，以及实现 Live2D 与 Spine 导出完全统一的路线图。

---

## 1. 已构建的内容

### 1.1 数据模型

`project.*` 中新增了三个一等概念：

#### `project.parameters[]`
命名滑块，实时驱动轨道，并持久化存储在项目文件中。

```js
{
  id:      string,        // e.g. "ParamAngleX"
  name:    string,
  min:     number,        // slider minimum
  max:     number,        // slider maximum
  default: number,        // rest-pose value
  bindings: [
    {
      animationId: string,   // which animation clip holds the track
      nodeId:      string,   // which node's track this parameter drives
      property:    string,   // 'mesh_verts' | 'rotation' | 'opacity' | …
    }
  ]
}
```

运行时滑块值存放在**单独的 `parameterStore`**中（不持久化、不进撤销历史），因此快速拖动滑块永远不会淹没撤销栈。

#### `project.physicsRules[]`
可编辑的摆锤/弹簧规则数组（与 `cmo3/physics.js` 中旧的硬编码 `PHYSICS_RULES` 结构相同）。对于尚未配置原生规则的项目，导出会回退到硬编码默认值。

#### `warpDeformer` 节点类型
一种场景树节点，行为类似组，但携带晶格网格和参数绑定。

```js
{
  id:          string,
  type:        'warpDeformer',
  name:        string,
  parent:      string | null,
  visible:     boolean,
  col:         number,        // lattice columns  (default 2)
  row:         number,        // lattice rows     (default 2)
  gridX:       number,        // canvas-space bounds
  gridY:       number,
  gridW:       number,
  gridH:       number,
  parameterId: string | null, // which parameter drives keyform interpolation
}
```

网格控制点位置（keyform）以 `mesh_verts` 动画轨道的形式存储在弯曲变形器节点自身上，按动画时间作为键。时间↔参数值的映射由 `animationEngine.js` 中的 `computeParameterDrivenOverrides` 处理：

```
norm   = (paramValue − param.min) / (param.max − param.min)
timeMs = track.keyframes[0].time + norm × (lastKf.time − firstKf.time)
```

### 1.2 画布创作 UI

| 组件 | 用途 |
|-----------|---------|
| `LayerPanel` —— “+ Warp” 按钮 | 创建一个 `warpDeformer` 节点 |
| `WarpDeformerPanel`（Inspector） | 编辑 col/row、网格边界、参数绑定；“Fit to children” 自动调整尺寸 |
| `ParametersPanel` | 创建参数，添加指向弯曲变形器的 `mesh_verts` 绑定 |
| `WarpLatticeOverlay` | 选中弯曲变形器时显示的 SVG 控制点网格；拖动会提交关键帧 |
| `GizmoOverlay` | 当选中节点为弯曲变形器时，提前退出并转交给 `WarpLatticeOverlay` |

### 1.3 实时预览

`CanvasViewport` 的 rAF 循环在混合变形求值后运行两趟处理：

1. **参数驱动覆盖**（`computeParameterDrivenOverrides`）—— 将每个参数的当前滑块值映射为任何已绑定节点（包括弯曲变形器节点）的插值后 `mesh_verts` 值。结果合并进 `poseOverrides`。

2. **双线性弯曲处理** —— 对于每个在 `poseOverrides` 中有激活 `mesh_verts` 的 `warpDeformer` 节点，递归进入其所有后代网格部件（穿过嵌套组*和*嵌套弯曲变形器），并通过变形后的网格对每个顶点进行双线性重映射。变形以叠加方式累积：每个弯曲使用 REST 顶点位置进行 UV 参数化，然后将自身的增量叠加在先前已应用的弯曲偏移之上。这确保无论求值顺序如何，嵌套弯曲都能正确复合。

#### 嵌套弯曲变形器支持

当弯曲变形器包含另一个弯曲变形器作为子级时（例如 `BodyWarp` 包含 `head` 组，而该组又包含 `FaceWarp`），两个弯曲都会在双线性处理中被求值：
- 父弯曲（`BodyWarp`）递归遍历其整个子树，包括嵌套弯曲节点，并变形所有后代网格部件。
- 每个子弯曲（`FaceWarp`）也会被独立求值，仅使用直接部件子级作为变形目标。
- 顶点位置累积：`final = rest + parent_delta + child_delta`。

网格边界通过 `autoGenerateWarpDeformers` 初始化，使用递归包围盒收集，涵盖穿过组和弯曲变形器的所有后代，因此父弯曲从一开始就涵盖整个视觉区域（头部 + 躯干）。

`WarpDeformerPanel` 中的 “Fit to Children” 按钮会更新网格边界，并按比例重映射所有关键帧控制点，保持 UV/控制点的一致性。

#### 2.5D 透视自动生成
`buildWarpKeyframes` 工具（位于 `CanvasViewport.jsx`）使用非线性数学从 2D 晶格模拟 3D 旋转：
- **抛物线 X 位移**：对于 `face_angle_x`，中心（鼻子）突出更多，而远边缘向内包裹。
- **透视 Z 缩放**：近侧垂直放大（`dy` 调整），远侧缩小，产生深度效果。

---

## 2. 导出状态

### 2.1 `.cmo3` —— Cubism Editor 项目导出  ✅ 完全接入

| SS 概念 | CMO3 输出 |
|-----------|-------------|
| `project.parameters[]` | `CParameterGuid` + `CParameterSource` 条目 |
| `warpDeformer` 节点 | `CWarpDeformerSource`，带原生 col/row 和创作的网格边界 |
| 弯曲变形器 keyform | `CWarpDeformerForm` 条目（从子级 `mesh_verts` 轨道进行 IDW 传播） |
| 原生 `parameterId` | 参数链接替代旧的自动生成 `ParamDeform_*` |
| 嵌套组下的网格 | 正确归组到共享弯曲变形器下（祖先遍历） |
| `project.physicsRules[]` | `CPhysicsSettingsSourceSet`（若为空则回退到硬编码默认值） |
| 动画 | 与 `.cmo3` 并列的 `.can3` 文件 |

**代码路径：**  
`exportLive2DProject` → `generateCmo3`（3b.0 节 原生 warp 组）→ `emitPhysicsSettings`

### 2.2 `.moc3` —— Live2D SDK 运行时导出  ✅ 完全接入

| SS 概念 | MOC3 输出 |
|-----------|-------------|
| `project.parameters[]` | 带 min/max/default 的参数表 |
| `warpDeformer` 节点 | `CDeformer`（type=0 warp），带原生 col/row |
| 弯曲变形器 keyform | 每个 keyform 在 PPU 归一化空间中的网格位置 |
| 原生 `parameterId` | 参数链接驱动 `warp_deformer.keyform_binding_band_indices` |
| 弯曲变形器下的网格 | 通过 `art_mesh.parent_deformer_indices` 链接（祖先遍历） |
| 参数 keyform 绑定 | 在 keyform 范围内均匀间隔的参数值 |

**代码路径：**  
`exportLive2D` → `generateMoc3`（经由 `moc3writer.js` 中的 `buildSectionData`）：
- 从 `project.nodes` 收集 `warp_deformer` 节点
- 从 `project.animations` 构建 `mesh_verts` 轨道映射
- 计算 PPU 归一化的网格位置并追加到 `keyform_position.xys`
- 填充 `deformer.*`、`warp_deformer.*`、`warp_deformer_keyform.*` 区段
- 通过祖先遍历接入 `art_mesh.parent_deformer_indices`
- 分配参数 keyform 绑定（每个参数连续）

### 2.3 Spine 导出  ❌ 未转换弯曲变形器

Spine 没有弯曲变形器原语。当前的 `exportSpine.js` 将组导出为骨骼，将部件导出为槽位/区域附件，并将网格几何导出为带权重的网格附件。弯曲变形器节点被静默忽略。

---

## 3. 路线图

### 3.1 `.moc3` 弯曲变形器支持 —— ✅ 已完成（2026-04-27）

**实现摘要：**

在 `buildSectionData`（第 349–786 行）中：
- 将 `paramList` 定义前移（在弯曲变形器分析之前）
- 从动画中收集 `warpDeformer` 节点和 `mesh_verts` 轨道
- 构建每个弯曲变形器的元数据：col、row、gridPts、kfs、numKf、参数绑定、paramIdx
- 按 paramIdx 对绑定的弯曲变形器排序（确保连续的参数所有权范围）
- 祖先遍历：将每个网格部件映射到其最近的弯曲变形器祖先
- 填充计数：`WARP_DEFORMERS`、`WARP_DEFORMER_KEYFORMS`、`DEFORMERS`
- 扩展 `KEYFORM_POSITIONS` 计数以包含弯曲网格的 XY 对
- 更新绑定系统：添加变形器空 band（M+P..M+P+W-1）和弯曲真实 band（M+P+W..M+P+2W-1）
- 在 PPU 归一化空间中按行优先顺序将弯曲网格位置追加到 `keyform_position.xys`
- 填充变形器区段：ids、绑定 band 索引、可见性、父部件/变形器、类型、specific 索引
- 填充 warp_deformer 区段：绑定 band 索引、keyform 起始/数量、顶点数、行数、列数
- 填充 warp_deformer_keyform 区段：不透明度（1.0）、keyform 位置起始索引
- 分配参数 keyform 绑定：在 keyform 范围内从 min 到 max 均匀间隔的参数值
- 更新 `parameter.keyform_binding_begin_indices/counts` 以正确地将绑定分配给参数

在 `generateMoc3`（第 856–863 行）中：
- 写入 `quad_transforms` 区段，每个弯曲变形器一个 Bool32（0 = 双线性，非 quad）

**二进制的区段布局已存在。所需的补充如下：**

**要填充的计数：**
- `COUNT_IDX.WARP_DEFORMERS` —— 原生弯曲变形器节点的数量
- `COUNT_IDX.WARP_DEFORMER_KEYFORMS` —— 所有弯曲变形器的 keyform 总数
- `COUNT_IDX.DEFORMERS` —— 变形器总数（弯曲 + 旋转）

**每个弯曲变形器要写入的区段：**
```
warp_deformer.keyform_binding_band_indices  → index into keyform binding band
warp_deformer.keyform_begin_indices         → offset into keyform table
warp_deformer.keyform_counts                → number of keyforms (e.g., 2)
warp_deformer.vertex_counts                 → (col+1) × (row+1) grid points
warp_deformer.rows                          → row
warp_deformer.cols                          → col
```

**每个 keyform：**
```
warp_deformer_keyform.opacities                     → 1.0
warp_deformer_keyform.keyform_position_begin_indices → offset into positions array
```

**网格位置数组：**  
针对每个控制点、每个 keyform，在归一化变形器局部空间 `[0..1]` 中的扁平 `[x0,y0, x1,y1, …]`（与 `.cmo3` 弯曲形态位置相同的约定）。

**网格链接：**
```
art_mesh.parent_deformer_indices  → index of the warp deformer that owns this mesh
deformer.parent_deformer_indices  → -1 for root-level deformers
deformer.types                    → 0 = warp, 1 = rotation
deformer.specific_indices         → index into warp_deformer / rotation_deformer arrays
```

**Keyform 绑定：**  
每个弯曲变形器一个绑定 band，将参数索引及其键值（`[param.min, param.max]`）链接到 keyform 范围。

**实现已完成（以下所有步骤）：**
1. ✅ 从 `project.nodes` 收集 `warpDeformerNodes`（无需修改签名；数据来自 `project`）
2. ✅ 在数据分析阶段构建弯曲变形器索引映射和参数查找
3. ✅ 写入覆盖所有弯曲变形器的 `deformer.*` 区段（ids、可见性、父链接、类型、specific 索引）
4. ✅ 写入 `warp_deformer.*` 区段（绑定 band 索引、keyform 起始/数量、顶点数、网格维度）
5. ✅ 写入 `warp_deformer_keyform.*` 区段并将网格位置追加到 `keyform_position.xys`
6. ✅ 更新 `art_mesh.parent_deformer_indices`，通过祖先遍历引用所属变形器
7. ✅ 为每个弯曲变形器参数添加 keyform 绑定 band 与参数所有权链接

### 3.2 Spine 导出 —— 烘焙变形时间轴

Spine 没有弯曲变形器原语，但它有**变形时间轴**（`slot.deform`），可在特定动画时间存储网格附件的逐顶点位置增量。正确的策略是将弯曲变形器的效果**烘焙**进变形关键帧。

**算法（针对每个带绑定参数的弯曲变形器）：**

```
For N sample points across [param.min … param.max]:
  1. Set paramValue = sample[i]
  2. Compute current grid via interpolateMeshVerts on the warp deformer's track
  3. For each descendant mesh part:
     a. Bilinearly warp all rest vertices through the current grid
     b. Compute per-vertex deltas from rest positions
     c. Emit as a Spine `deform` keyframe at time = (i / N-1) * totalDuration
```

这会产生平滑的 Spine 变形动画，精确镜像 SS 弯曲预览，而无需 Spine 理解网格原语。

**Schema（Spine 4.0）：**
```json
"animations": {
  "WarpParam": {
    "slots": {
      "PartName": {
        "attachment": [
          {
            "time": 0.0,
            "name": "PartName",
            "vertices": [dx0,dy0, dx1,dy1, ...]
          }
        ]
      }
    }
  }
}
```

**实现的关键决策：**
- 采样点数 N：对大多数变形器 3–5 已足够；作为导出选项暴露
- 动画名称：使用参数的 `name` 字段（例如 `"ParamAngleX"`）
- 坐标系：Spine 为 Y-up；写入变形增量时翻转所有 `dy` 值
- 若弯曲变形器没有绑定参数，则跳过它（没有可生成的动画）

**建议的实现顺序：**
1. 向 `exportSpine.js` 添加 `collectDescendantMeshParts` 工具（对应 CanvasViewport 中的那个）
2. 在现有动画循环之后，添加一个弯曲变形器烘焙处理
3. 对于每个带 `parameterId` 绑定的弯曲变形器节点，运行采样算法
4. 将烘焙的变形关键帧以参数名称合并进 Spine 动画

### 3.3 将 `warpDeformer` 作为 Spine 层级的透明直通

当前 `exportSpine.js` 将 `type === 'group'` 映射为骨骼。`warpDeformer` 节点是类组的容器 —— 其子级应附加到弯曲变形器的父骨骼，而非弯曲变形器本身（因为 Spine 没有等价节点）。更新 Spine 导出器：

- `warpDeformer` 节点：作为骨骼跳过，但将其子级视为属于弯曲变形器的*父*骨骼
- 其直接或间接父级为 `warpDeformer` 的网格部件：通过向上遍历到第一个非弯曲变形器祖先来解析骨骼附件

### 3.4 标准 Live2D 覆盖缺口 —— ✅ 已完成（2026-04-27）

自动绑定器从 “Minimum Viable Rig”（2 个弯曲变形器、18 个参数）扩展到完整的 41 个参数标准集，含 13 个弯曲变形器。

#### 参数（共 41 个）
所有标准 Live2D 参数现已在 `LIVE_RIG_PARAMS` 中：
- **面部旋转**（3）：`ParamAngleX/Y/Z`
- **眼睛**（11）：`ParamEyeLOpen/ROpen`、`ParamEyeLSmile/RSmile`、`ParamEyeBallX/Y/Form`、`ParamTear`
- **眉毛**（8）：`ParamBrowLY/RY`、`ParamBrowLX/RX`、`ParamBrowLAngle/RAngle`、`ParamBrowLForm/RForm`
- **嘴部**（2）：`ParamMouthForm`、`ParamMouthOpenY`
- **身体旋转**（3）：`ParamBodyAngleX/Y/Z`
- **呼吸**（1）：`ParamBreath`
- **手臂**（6）：`ParamArmLA/RA`、`ParamArmLB/RB`、`ParamHandL/R`
- **肩部**（1）：`ParamShoulderY`
- **胸部**（2）：`ParamBustX/Y`
- **头发**（3）：`ParamHairFront/Side/Back`
- **全局**（4）：`ParamCheek`、`ParamHairFluffy`、`ParamBaseX/Y`

#### 弯曲变形器（自动生成）
**结构链**（躯干下 4 层，与 Live2D 导出匹配）：
- `BodyWarp`（5×5 网格，ParamBodyAngleX）—— 包裹所有躯干子级
  - `BreathWarp`（5×5 网格，ParamBreath）—— 细微的胸腔压缩
    - `BodyWarpY`（5×5 网格，ParamBodyAngleY）—— 前倾/后仰
      - `BodyWarpZ`（5×5 网格，ParamBodyAngleZ）—— 身体翻滚/倾斜
        - 所有后代（手臂、上衣、下装等）

**解剖部件**（头部和身体组下）：
- **头部组**：`FaceWarp`（5×5 网格，ParamAngleX），带嵌套弯曲
  - `EyeLWarp`（ParamEyeLOpen）、`EyeRWarp`（ParamEyeROpen）
  - `MouthWarp`（ParamMouthOpenY）
  - `EyebrowLWarp`（ParamBrowLY）、`EyebrowRWarp`（ParamBrowRY）
  - `HairFrontWarp`（ParamHairFront）、`HairBackWarp`（ParamHairBack）
- **颈部组**：`NeckWarp`（5×5 网格，ParamAngleX）
- **衣物**：`TopWearWarp`（位于 BodyWarpZ 下）、`BottomWearWarp`（自动重新设为 BodyWarpZ 的子级）

#### 弯曲数学类型（共 11 种）
- `face_angle_x`（带抛物线 X 位移和透视 Z 缩放的 2.5D 头部转向）
- `face_angle_y`（头部俯仰：带非对称弓形的上/下）
- `body_angle_x`（带 3D 透视的肩部倾斜）
- `body_angle_y`（躯干俯仰：前倾/后仰）
- `body_angle_z`（身体翻滚：以脊柱为旋转轴左右倾斜）
- `neck_follow`（随头部倾斜以降低幅度的颈部剪切）
- `eye_open`（带顶行挤压的眼睑闭合）
- `mouth_open`（下颌下张：顶/底行扩展）
- `brow_y`（均匀垂直平移）
- `hair_sway`（偏重发梢的水平摇摆）
- `breathing`（吸气时胸腔压缩，带固定边缘和水平挤压）

#### 实现细节

**`LIVE_RIG_PARAMS` 数组**（`CanvasViewport.jsx:109–156`）：
- 定义了全部 41 个参数，带正确的 min/max/default
- 按语义组组织（Face、Eye、Brow、Mouth、Body、Hair、Global）

**`WARP_SPECS` 数组**（`CanvasViewport.jsx:171–204`）：
- **三种模式**：`boneRole`、`layerTags` 和 `chainedUnderWarp`
- **boneRole 模式**（3 个规格，5×5 网格）：FaceWarp、BodyWarp、NeckWarp —— 包裹整个组内容
- **layerTags 模式**：眼、嘴、眉、头发、上衣、下装弯曲 —— 目标为父级内带标签的部件
- **chainedUnderWarp 模式**（3 个规格，5×5 网格）：BreathWarp、BodyWarpY、BodyWarpZ —— 创建结构弯曲链
  - 每个都以上一个弯曲为父级
  - 重新设为父级弯曲所有子级的子级（插入到层级中）
  - 匹配 Live2D 导出的结构变形器链
- 每个规格携带 `warpType` 以供 `buildWarpKeyframes` 查找
- 网格尺寸：结构/解剖部件为 5×5，精细细节部件为 2×2

**`buildWarpKeyframes` 函数**（`CanvasViewport.jsx:206–415`）：
- 11 个弯曲类型分支，每种变形类型都有完整的数学
- 每种类型返回 2–3 个关键帧（时间→网格变形映射）
- 数学使用归一化行/列坐标（0..1）以及用于幅度控制的 `scale` 参数
- **breathing 弯曲**（新增）：带固定边缘、按行幅度、水平挤压的胸腔压缩
- **body_angle_z**（新增）：带弓形因子和通过正弦曲线实现的 3D 深度的身体翻滚

**`autoGenerateWarpDeformers` 函数**（`CanvasViewport.jsx:1403–1620`）：
- 支持三种模式：`boneRole`、`layerTags` 和 `chainedUnderWarp`
- **boneRole 模式**：包裹骨骼组的所有直接子级，5×5 网格
- **layerTags 模式**：递归查找子树内匹配标签的部件，将弯曲创建为其子级
- **chainedUnderWarp 模式**：将弯曲创建为指定父弯曲的子级，重新设为父级弯曲所有子级的父级
  - 将新弯曲插入层级，构建结构链
  - 从父弯曲的后代计算边界
  - 在节点上存储 `warpType` 以供强度调整查找
- 后处理：将 BottomWearWarp 重新设为 BodyWarpZ 的子级，使其受整个弯曲链影响
- 调用 `collectBounds` 和 `collectTaggedParts` 工具进行树遍历
- 若不存在则创建 “Parameters” 动画片段，并添加带关键帧的 mesh_verts 轨道

**`handleWarpStrength` 函数**（`CanvasViewport.jsx:1417–1438`）：
- 现在处理每个参数的多个弯曲节点
- 使用 `warpNode.warpType`（回退到 WARP_SPECS 查找）来以新 scale 重建关键帧

#### 完全实现的参数（41 个中有 12 个带自动生成的弯曲变形器）

✅ **结构弯曲：**
- `ParamBodyAngleX`（BodyWarp）—— 肩部/躯干倾斜
- `ParamBreath`（BreathWarp）—— 胸腔压缩
- `ParamBodyAngleY`（BodyWarpY）—— 躯干俯仰（前倾/后仰）
- `ParamBodyAngleZ`（BodyWarpZ）—— 身体翻滚（左右倾斜）

✅ **解剖弯曲：**
- `ParamAngleX`（FaceWarp、NeckWarp）—— 带 2.5D 透视的头部转向
- `ParamEyeLOpen`、`ParamEyeROpen`（EyeLWarp、EyeRWarp）—— 眼睑开合
- `ParamMouthOpenY`（MouthWarp）—— 嘴部张开
- `ParamBrowLY`、`ParamBrowRY`（EyebrowLWarp、EyebrowRWarp）—— 眉毛垂直移动
- `ParamHairFront`、`ParamHairBack`（HairFrontWarp、HairBackWarp）—— 头发摇摆

#### 缺失的弯曲变形器（41 个参数中有 29 个）

已定义参数但无自动生成弯曲（可手动创建）：
- **面部旋转**：`ParamAngleY`（俯仰）、`ParamAngleZ`（翻滚）—— 有弯曲数学但无规格
- **眼睛**（8）：ParamEyeLSmile、ParamEyeRSmile、ParamEyeBallX/Y/Form、ParamTear
- **眉毛**（6）：ParamBrowLX、ParamBrowRX、ParamBrowLAngle、ParamBrowRAngle、ParamBrowLForm、ParamBrowRForm
- **嘴部**（1）：ParamMouthForm
- **手臂**（6）：ParamArmLA/RA、ParamArmLB/RB、ParamHandL/R
- **其他**（8）：ParamShoulderY、ParamBustX/Y、ParamCheek、ParamHairFluffy、ParamBaseX/Y

要为剩余参数完成自动生成：
1. 添加以 `layerTags` 定位相关部件的 `WARP_SPECS` 条目
2. 实现对应的 `buildWarpKeyframes` 弯曲类型（弯曲数学可在预览中原型化，然后应用）

---

## 4. 所有导出器共享的不变量

无论目标格式如何，这些契约都必须成立：

| 不变量 | 为何重要 |
|-----------|---------------|
| Keyform 以 `mesh_verts` 轨道存储在弯曲变形器节点上，按时间作为键 | 所有导出路径读取同一来源；无格式特定的创作 |
| `computeParameterDrivenOverrides` 是唯一的插值路径 | 预览和烘焙导出使用相同的数学；无漂移 |
| `collectDescendants(parentId)` 递归穿过嵌套 `warpDeformer` 节点 | 父弯曲始终能到达孙辈部件；所有网格部件都被所有祖先弯曲变形 |
| UV 参数化使用 REST 顶点，而非当前弯曲后的位置 | 每个弯曲独立计算其增量；增量累积：`final = rest + Σ(deltas)` |
| `warpDeformerParentId` 通过祖先遍历找到，而不仅是 `part.parent` | 支持任意深度嵌套在弯曲变形器下组内的网格 |
| 网格边界初始化包含所有后代（递归） | `autoGenerateWarpDeformers` 使用穿过组和弯曲变形器的包围盒收集 |
| “Fit to Children” 在调整尺寸时按比例重映射关键帧点 | 保持 UV 参数化一致性：`new_pt = new_grid_origin + (old_relative_pos) * (new_size / old_size)` |
| 参数的 `min/max` 定义完整变形范围 | `.moc3` keyform 绑定 band、Spine 动画时长和 `.cmo3` 参数都读取同一字段 |

---

## 5. 文件参考

| 文件 | 角色 |
|------|------|
| `src/store/projectStore.js` | `warpDeformer` 节点 schema、`createWarpDeformer`、参数/物理 CRUD |
| `src/store/parameterStore.js` | 运行时滑块值（不持久化） |
| `src/renderer/animationEngine.js` | `computeParameterDrivenOverrides`、`interpolateMeshVerts`、`upsertKeyframe` |
| `src/components/canvas/CanvasViewport.jsx` | rAF 循环中的双线性弯曲处理 |
| `src/components/canvas/WarpLatticeOverlay.jsx` | 画布控制点编辑 UI |
| `src/components/canvas/GizmoOverlay.jsx` | 选中弯曲变形器时路由到 `WarpLatticeOverlay` |
| `src/components/inspector/WarpDeformerPanel.jsx` | 网格尺寸、边界、参数绑定、“Fit to children” |
| `src/components/parameters/ParametersPanel.jsx` | 参数滑块 + 绑定管理 |
| `src/components/export/ExportModal.jsx` | 物理标签页、`generateRig` 开关 |
| `src/io/live2d/exporter.js` | 用于 `warpDeformerParentId` 的祖先遍历；将 `warpDeformerNodes` 传给 `generateCmo3` |
| `src/io/live2d/cmo3writer.js` | 3b.0 节：原生 warp 组 → `CWarpDeformerSource` |
| `src/io/live2d/moc3writer.js` | `buildSectionData`：弯曲变形器区段（deformer、warp_deformer、warp_deformer_keyform）；`generateMoc3`：quad_transforms 输出 |
| `src/io/live2d/cmo3/physics.js` | `emitPhysicsSettings` 接受 `rules` 参数 |
| `src/io/exportSpine.js` | **TODO**：烘焙弯曲变形时间轴；在层级中跳过弯曲变形器（将子级传给父骨骼） |

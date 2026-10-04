# Live2D 导出实现

本文档描述 Stretchy Studio 中的 Live2D Cubism 导出功能 —— 涵盖运行时（.moc3）和项目（.cmo3）两种格式。

## 概述

Stretchy Studio 可以将项目导出为 **Live2D Cubism V4.0** 格式，从而能够集成到：
- 游戏引擎（Unreal、Cocos 等有官方 Cubism SDK 的引擎）
- Ren'Py 视觉小说框架
- Live2D Cubism SDK 应用程序
- Cubism Editor 5.0（用于项目编辑）

> ⚠️ **Godot 例外（实验性）**：Live2D 官方 **没有** Godot 版 SDK（官方仅提供 Unity / Unreal / Native / Web / Java / Cocos）。在 Godot 中只能使用第三方社区实现，兼容性与稳定性无法保证，仅供实验。详见下文「实验性：Godot 支持」。

## 导出类型

### 1. Live2D 运行时（.moc3）

**它是什么：** 供使用 Live2D Cubism SDK 4.0+ 的游戏引擎和应用使用的独立模型文件。

**输出：** 包含以下内容的 ZIP 文件：
- `.moc3` —— 二进制模型文件
- `.model3.json` —— 清单（引用所有资源）
- `model.{size}/` —— 贴图图集 PNG（例如 `model.2048/texture_00.png`）
- `.cdi3.json` —— 显示信息（人类可读名称）
- `motion/*.motion3.json` —— 动画曲线（若存在动画）

**工作流程：**
1. 从 Stretchy Studio 导出模型
2. 解压文件
3. 将 `.model3.json` 载入你的游戏引擎或应用
4. 角色渲染出贴图并支持基础动画

**功能支持：**
| 功能 | 支持 |
|---------|-----------|
| 网格几何 | ✅ 支持 |
| 贴图图集 | ✅ 支持（优化打包） |
| 部件层级（组） | ✅ 支持（仅可见性） |
| 不透明度动画 | ✅ 支持 |
| 旋转动画 | ⚠️ 不支持（请改用 .cmo3） |
| 网格变形动画 | ⚠️ 不支持（请改用 .cmo3） |
| 骨骼权重烘焙 | ⚠️ 不支持（请改用 .cmo3） |

**注意：** 虽然旋转参数曲线会被导出到 `.motion3.json`，但旋转变形器尚未在 `.moc3` 二进制写入器中实现。若需要旋转和变形动画，请改用 .cmo3 项目导出。

### 2. Live2D 项目（.cmo3）

**它是什么：** 供 Cubism Editor 5.0 使用的可编辑项目文件，支持动画。

**输出：**
- **无动画时：** 单个 `.cmo3` 文件
- **有动画时：** 包含 `.cmo3`（模型）+ `.can3`（动画）的 ZIP

**工作流程：**
1. 从 Stretchy Studio 导出项目
2. 在 Cubism Editor 5.0 中打开 `.cmo3`
3. 编辑、调整、添加物理或表情
4. 发布最终模型以供运行时使用

**功能支持：**
| 功能 | 支持 |
|---------|-----------|
| 网格几何 | ✅ 支持 |
| 贴图（按网格） | ✅ 支持 |
| 部件层级（组） | ✅ 支持 |
| 旋转变形器 | ✅ 支持 |
| 旋转动画 | ✅ 支持 |
| 网格弯曲变形 | ✅ 支持 |
| 网格弯曲动画 | ✅ 支持 |
| 骨骼权重烘焙 | ✅ 支持（肘/膝弯曲） |
| 不透明度动画 | ✅ 支持 |
| 参数组 | ⚠️ 基础（无 LipSync/EyeBlink 预设组） |
| 物理 | ❌ 不支持（在 Cubism Editor 中手动添加） |
| 表情（.exp3.json） | ❌ 不支持（在 Cubism Editor 中手动添加） |

**建议：**
- 动画较多的角色请使用此格式
- 为所有组自动创建旋转变形器
- 所有网格变形都会被保留且可动画化
- 骨骼权重允许自然的肢体弯曲且无网格接缝

---

## 技术细节

### 文件位置

| 组件 | 文件 |
|-----------|------|
| 主导出器 | `src/io/live2d/exporter.js` |
| MOC3 二进制写入器 | `src/io/live2d/moc3writer.js` |
| CMO3 XML 生成器 | `src/io/live2d/cmo3writer.js` |
| CAN3 动画生成器 | `src/io/live2d/can3writer.js` |
| Model3 JSON | `src/io/live2d/model3json.js` |
| Motion3 JSON | `src/io/live2d/motion3json.js` |
| 显示信息（CDI3） | `src/io/live2d/cdi3json.js` |
| 贴图图集打包器 | `src/io/live2d/textureAtlas.js` |
| CAFF 归档打包器 | `src/io/live2d/caffPacker.js` |
| XML 工具 | `src/io/live2d/xmlbuilder.js` |
| UI 组件 | `src/components/export/ExportModal.jsx` |

### 数据映射

**Stretchy Studio → Live2D 概念：**

| SS 概念 | MOC3 | CMO3 |
|-----------|------|------|
| 部件（无网格） | — | CPartSource（可见性） |
| 部件（带网格） | ArtMesh | CArtMeshSource |
| 组 | Part | CPartSource + CRotationDeformerSource |
| 组旋转轨道 | — | CRotationDeformerSource + 动画 |
| 网格不透明度轨道 | 部件不透明度 | ArtMesh 不透明度 |
| 网格顶点轨道 | — | 弯曲变形器 + 动画 |
| 贴图 | 图集区域 | CLayer + CImageResource |
| 骨骼权重 | — | Keyform 数组（烘焙） |
| 动画片段 | — | CAnimationSource（.can3） |

### 贴图图集打包

Stretchy Studio 使用 **MaxRects BSSF（Best Short Side Fit）** 并配合缩放因子的二分查找。这复现了 Cubism Editor 的图集优化行为。

**算法：**
1. 从每个部件的贴图中提取不透明边界
2. 二分查找能够放入图集的最大统一放大倍数
3. 按缩放后最大维度降序排列部件
4. 使用 MaxRects BSSF 打包
5. 输出为 PNG 图集（默认 2048×2048）

### 骨骼权重烘焙

对于带骨骼权重网格（例如带肘部的手臂）的 `.cmo3` 导出：

1. 每个顶点携带一个骨骼权重（0.0–1.0）
2. 在静止姿态下（无旋转），顶点渲染在其原始位置
3. 当骨骼旋转时，顶点通过位置的加权混合变形
4. 这被编码为 `.cmo3` 中的多个 **keyform**（姿态）
5. Live2D 根据变形器参数值渲染正确的 keyform

**结果：** 平滑的肢体弯曲且无网格接缝（肘/膝关节自然弯曲）。

---

## 已知局限

### MOC3 运行时导出
- ❌ **无旋转变形器** —— 旋转参数被创建但未绑定（在运行时被静默忽略）
- ❌ **无网格变形动画** —— mesh_verts 轨道被映射到不存在的参数
- ❌ **仅限于不透明度动画** —— 只有不透明度关键帧真正驱动视觉变化

**变通方法：** 动画工作请使用 .cmo3 项目导出。

### CMO3 项目导出
- ❌ **无物理** —— 头发/衣物物理必须在 Cubism Editor 中添加
- ❌ **无表情**（.exp3.json）—— 在 Cubism Editor 中手动添加
- ❌ **无姿态组**（.pose3.json）—— 不支持服装切换
- ⚠️ **合并的肢体网格** —— 单个 `legwear` 图层无法独立动画化左/右膝盖（拆分为 `legwear_l`/`legwear_r`）

---

## 工作流程建议

### 用于部署（游戏/应用）

1. **在 Stretchy Studio 中创建角色**，包含网格和基础设置
2. **导出为 .cmo3 项目**
3. **在 Cubism Editor 中打开**以进行最终打磨（物理、表情、参数组）
4. **从 Editor 发布**以获得最终的 `.moc3` + 资源
5. **将 .moc3 集成到游戏引擎**

### 用于以动画为主的工作

1. **使用 .cmo3 项目导出**（完整的旋转 + 变形支持）
2. **在 Cubism Editor 中或通过 `.can3` 曲线创建动画**
3. **在 Cubism Viewer 中测试**
4. **从 Editor 导出最终模型**以供运行时使用

### 用于快速运行时测试

1. **从 Stretchy Studio 导出为 .moc3 运行时**
2. **载入 Cubism SDK 应用或游戏引擎**
3. **注意：** 旋转/变形动画不会工作；如有需要请使用 .cmo3

---

## UI 警告

**Export Modal** 会显示有用的警告：

- ✅ `.cmo3 project export` —— 完整功能集，可在 Cubism Editor 中编辑
- ⚠️ `.moc3 runtime export` —— 仅限于不透明度动画；旋转/变形建议使用 `.cmo3`
- ⚠️ **实验性提示（Godot）** —— 选择任一 Live2D 导出类型时，弹窗都会显示「Godot 没有官方 Live2D 运行时，只能依赖社区实现，兼容性与稳定性无法保证，仅供实验使用，请勿用于生产环境」的提示。

---

## 实验性：Godot 支持

Live2D Cubism SDK 官方支持平台为 **Unity / Unreal Engine / Native(C++) / Web / Java / Cocos Creator**，其中 **不包含 Godot**。因此在 Godot 中使用本导出产物属于**实验性**方案：

| 导出类型 | 能否在 Godot 直接使用 | 说明 |
|----------|----------------------|------|
| `.cmo3` 工程文件 | ❌ 不能 | 这是 Cubism Editor 的工程文件，Godot 不识别；需先在 Cubism Editor 中打开并发布 `.moc3` |
| `.moc3` 运行时 | ⚠️ 视社区实现而定 | 需搭配社区维护的 Live2D for Godot（GDScript/GDExtension）运行时；官方无支持，版本与功能兼容性不保证 |
| 帧序列（PNG/WebP 序列） | ✅ 可以 | 属于通用图像导出，可导入 Godot 的 `AnimatedSprite2D` / `SpriteFrames` |

**风险提示：**
- 社区运行时可能无法覆盖全部 Cubism 特性（如物理、表情、参数组、变形器），加载失败或表现异常都属正常现象。
- 社区运行时的 SDK 版本需与本导出产物声明的 **Cubism 4.0** 对齐，跨版本可能出现解析失败。
- 请勿将 Live2D 导出用于 Godot 生产项目；如必须使用，请先做充分的兼容性验证。

**推荐替代：** 若目标引擎是 Godot，优先使用 **Spine 导出**（有官方 spine-godot 运行时）或**帧序列导出**。

---

## 实现说明

### 坐标空间处理

Live2D 对不同文件类型使用不同的坐标系：

- **画布空间：** 原点在左上角，Y 向下（与 Stretchy Studio 相同）
- **变形器局部空间：** 相对于变形器原点（在 `.cmo3` 内部使用）

导出器会自动处理这一点 —— 网格 UV 和渲染位置会根据上下文正确变换。

### 参数生成

- **MOC3：** 从 `project.parameters[]`（用户定义列表）读取
- **CMO3：** 从组/网格结构自动生成 `ParamRotation_*` 和 `ParamDeform_*`

要让自定义参数在 `.moc3` 中生效，请将它们添加到项目的参数列表中。

### 动画轨道属性

动画导出支持的轨道属性：

| 属性 | MOC3 | CMO3 | 备注 |
|----------|------|------|-------|
| `opacity` | ✅ | ✅ | 部件/网格不透明度 |
| `rotation` | ⚠️（未绑定） | ✅ | 组旋转（仅 CMO3） |
| `mesh_verts` | ⚠️（未绑定） | ✅ | 网格弯曲变形（仅 CMO3） |
| `x`, `y`, `scale*` | ❌ | ❌ | 不导出（使用根组偏移） |

---

## 故障排查

| 问题 | 原因 | 解决方案 |
|---------|-------|----------|
| 网格渲染上下颠倒或反向 | 顶点顺序问题 | 在 Stretchy Studio 中重新生成网格 |
| 网格上贴图错误 | 贴图 ID 不匹配 | 确保 part.textureId 与已载入的贴图匹配 |
| .moc3 中旋转不工作 | 不支持旋转变形器 | 改用 .cmo3 项目导出 |
| 肘/膝弯曲错误 | 骨骼权重未烘焙 | 确保网格有 `boneWeights` 数组（在网格编辑器中生成） |
| .cmo3 打开为 “(Recovered)” | XML schema 不匹配 | 检查 Cubism Editor 版本（5.0+）；重新生成导出 |
| .can3 中缺少参数 | 组上没有动画轨道 | 在动画时间轴中为组添加旋转关键帧 |

---

## 版本历史

- **2026-04-15：** 初始实现
  - MOC3 运行时导出（.moc3 + atlas + .motion3.json）
  - CMO3 项目导出（.cmo3 + .can3）
  - 贴图图集打包（MaxRects BSSF）
  - 用于肢体变形的骨骼权重烘焙
  - 针对 MOC3 功能支持有限的 UI 警告
- **2026-04-19：** 自动绑定引擎（P7-P11）
  - **程序化眨眼**：解剖学感知的抛物线拟合闭合（追踪 eyewhite/eyelash 底部）。
  - **3D 面部视差**：虚拟半球旋转，带圆柱穹顶俯仰（AngleX/Y）。
  - **受保护的面部区域**：眼/嘴/眉邻近保护，防止贴图拉伸。
  - **标准参数映射**：ParamAngleX/Y/Z、ParamEyeBall、ParamMouthOpen 等。
  - **绑定调试**：集成 `.rig.log.json` 输出，用于程序化拟合的诊断追踪。
  - **组旋转集成**：恢复了自定义颈/头旋转滑块的功能，通过自适应像素/归一化原点映射将它们接入结构变形链。

---

## 🏗️ 自动绑定系统

当在 Export Modal 中启用 “Generate standard Live2D rig” 时，Stretchy Studio 会对你的角色执行程序化分析，以构建一个与 Cubism Editor 标准参数集兼容的高质量绑定。

### 1. 几何面部视差（AngleX / AngleY）
用 3D 半球投影替代手动关键帧：
- **AngleX（偏航）**：网格点围绕虚拟 Y 轴旋转 30°。面部中心比边缘位移更多，产生几何深度。
- **AngleY（俯仰）**：使用**圆柱穹顶**投影来垂直移动各列。这避免了球面俯仰模型常见的“挤压”伪影。
- **ParamAngleZ**：围绕程序化检测到的**下巴锚点**（“face” 标签网格的底部中心）旋转头部，产生自然的摆动弧线。

### 2. 基于邻近的保护
为防止视差期间面部特征被拉伸，系统应用**受保护区域**：
- 眼睛和眉毛被视为刚性岛屿。
- 在眼睛中心附近，视差位移从纯网格变形转换为**刚性平移**。
- 这确保虹膜和睫毛保持其形状，而面部“皮肤”围绕它们变形。

### 3. 程序化眼睛闭合（ParamEyeLOpen / ParamEyeROpen）
系统使用**解剖学感知的抛物线拟合**，而非通用的“窗帘”下落：
- **扫描**：扫描 `eyewhite` 和 `eyelash` 标签网格的最底部顶点。
- **拟合**：拟合一条最小二乘抛物线，以确定角色独特的下眼睑曲线。
- **闭合**：所有眼部部件（睫毛、眼白、虹膜）都朝这条自定义曲线压缩。 
- **结果**：完美的眼睛闭合，匹配角色绘制的眼睛形状，无缝隙也无需手动调整顶点。

### 4. 绑定层级
导出器会自动组织 `.cmo3` 层级：
- `Body Z` → `Body Y` → `Breath` → `Body X`（标准堆叠）
- `Face Rotation`（结构性头部倾斜，若存在则目标为 `GroupRotation_head`）
- `Face Parallax`（所有面部特征的单一统一变形）
- `Neck Warp`（结构性颈部倾斜，若存在则目标为 `GroupRotation_neck`）
- 针对发梢、眉毛和衣物的独立绑定变形。

### 6. 组旋转集成
**Rotation Neck** 和 **Rotation Head** 的功能性参数，通过将项目的组层级集成到绑定链中来实现。这使你能够同时用标准程序化参数（如 `Angle Z`）和自定义组旋转滑块来驱动角色的解剖结构。
- **视觉准确性**：使用自适应坐标映射处理嵌套组（例如 Neck 内的 Head），确保轴心锁定到角色的解剖结构。

### 5. 标签驱动参数
系统使用图层标签将部件绑定到标准参数：
- `#eyebrow-l` → `ParamBrowLY`
- `#mouth` → `ParamMouthOpenY` + `ParamMouthForm`
- `#front hair` → `ParamHairFront`
- `#eyelash-l`、`#irides-l` → `ParamEyeLOpen` + `ParamEyeBallX/Y`

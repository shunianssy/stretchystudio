# Spine 4.0 导出实现细节

本文档概述 Stretchy Studio 中 Spine 4.0 JSON 导出管线的技术实现。

## 概述
导出管线将 Stretchy Studio 的内部项目结构（节点、贴图、动画）转换为一个兼容 Spine 的 ZIP 包，其中包含 `skeleton.json` 及关联的图像资源。

## 核心映射
- **层级**：Stretchy Studio 的 “Groups” 映射到 Spine 的 “Bones”。 “Parts” 映射到 Spine 的 “Slots” 和 “Region Attachments”。
- **坐标**： 
  - Stretchy Studio（SS）使用 Y 向下、原点在左上角的坐标系。
  - Spine 使用 Y 向上的坐标系。
  - 设置姿态（setup pose）的骨骼位置按局部空间增量计算，即从父骨骼轴心到子节点轴心。
- **动画**：位移（Translation）、旋转（Angle）和不透明度（Opacity）轨道被映射到 Spine 的 `translate`、`rotate` 和 `rgba` 时间轴。

## 挑战与解决方案

### 1. 命名冲突
**问题**：Spine 严格规定每个项目都必须有一根名称恰为 `root` 的骨骼作为绝对父级。如果用户在 Stretchy Studio 中将某组图层命名为 `root`，导出会因名称重复而失败。
**解决方案**：`sanitizeName` 工具会在导出期间自动将用户定义的、名为 `root` 的节点重命名为 `rig_root`。

### 2. 坐标“漂移”
**问题**：最初，我们使用世界空间减法来计算骨骼偏移。然而，当父级关节已被旋转时进行导出，会导致子级附件漂移，因为 Spine 期望在应用旋转*之前*，设置姿态使用局部空间偏移。
**解决方案**：改用纯粹的局部空间增量计算：
```javascript
dx = (child.x + child.pivotX) - parent.pivotX
dy = (child.y + child.pivotY) - parent.pivotY
```
这确保了无论当前姿态如何，绑定结构都与 “Edit Mode” 布局一致。

### 3. 动画属性 Schema（Spine 3.8 vs 4.0）
**问题**：动画被导入但旋转关键帧被忽略（显示为 0）。
**解决方案**：发现 Spine 4.0 将旋转的 JSON 键从 `"angle"` 改为 `"value"`。已将动画映射器更新为使用 4.0 schema。

### 4. 轴心对齐
**问题**：旋转围绕组的中心发生，而非用户放置的自定义关节手柄。
**解决方案**：将 `pivotX` 和 `pivotY` 集成到世界位置计算中，确保 Spine 中“骨骼”的原点与 Stretchy Studio 中的关节手柄精确对齐。

## 用法
1. 打开 **Export Modal**。
2. 选择 **Type: Spine (4.0+)**。
3. 点击 **Export**。
4. 在 Spine 中，使用 `Spine menu > Import Data...`，并将 `Images` 路径指向解压出的 `images/` 文件夹。

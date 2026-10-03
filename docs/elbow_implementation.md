# 关节实现与顶点蒙皮

Stretchy Studio 使用一套自定义、轻量级的 JavaScript 驱动蒙皮引擎来实现逼真的肢体弯曲（肘部和膝盖）。本文档详述其技术实现、数学模型以及已识别的技术债。

## 1. 概述

为保持渲染性能并避免复杂的 GPU 着色器逻辑，肢体变形在 CPU 上计算，并注入到已有的顶点覆盖（vertex override）管线中。

- **权重计算**：在网格生成/重网格化期间执行。
- **变形**：在 `SkeletonOverlay` 的输入处理循环中实时执行。
- **插值**：由标准 `animationEngine` 使用顶点数组混合处理。

## 2. 顶点权重模型

肢体图层（例如 `handwear-l`）被附加到一根“肩部”骨骼（`leftArm`）。一根“肘部”骨骼（`leftElbow`）作为子级轴心。

### 轴感知投影
系统通过将每个顶点投影到由“肩到肘”轴所定义的向量上来计算权重。

```javascript
// Axis vector from shoulder (sx, sy) to elbow (jx, jy)
const axDx = jx - sx;
const axDy = jy - sy;
const axLen = Math.sqrt(axDx * axDx + axDy * axDy) || 1;
const axX = axDx / axLen;
const axY = axDy / axLen;

// Signed distance of vertex past the elbow pivot along the axis
const proj = (v.x - jx) * axX + (v.y - jy) * axY;

// Normalize weight with a 40px blending zone
const weight = Math.max(0, Math.min(1, proj / 40 + 0.5));
```

- **权重 0.0**：刚性绑定到肩部（上肢体）。
- **权重 1.0**：刚性绑定到肘部旋转（下肢体）。
- **0.0 - 1.0**：混合变形（关节）。

## 3. 实时交互

### 交互拦截
`SkeletonOverlay.jsx` 拦截角色匹配 `leftElbow`、`rightElbow`、`leftKnee` 或 `rightKnee` 的骨骼的指针事件。

1. **PointerDown**：捕获所有依赖部件（其 `mesh.jointBoneId` 与被拖动骨骼匹配的部件）的“起始”顶点位置。
2. **PointerMove**：为每个顶点计算旋转矩阵。旋转角度按顶点权重缩放（`rad * weight`）。
3. **DraftPose 流式传输**：产生的变形顶点被直接写入 `draftPose.mesh_verts`。

### 渲染循环集成
`CanvasViewport.jsx` 中的 `rAF` tick 已被修改为始终将 `draftPose.mesh_verts` 注入 `poseOverrides` 映射。这使得即便编辑器处于 **Staging** 模式，GPU 也能上传新位置，从而在绑定期间提供即时视觉反馈。

## 4. 关键帧化

当关节骨骼（肘部/膝盖）被关键帧化时（通过 `K` 键），系统会自动将选择范围扩展到包含所有“依赖部件”。这确保当前的顶点变形被保存为部件上的顶点关键帧，从而将骨骼旋转与网格变形紧密同步。

## 5. 技术债与注意事项

> [!IMPORTANT]
> **硬编码角色令牌**：实现依赖对 `leftElbow`、`rightElbow`、`leftKnee` 和 `rightKnee` 的精确字符串匹配。新增肢体关节需要在 `CanvasViewport.jsx`、`SkeletonOverlay.jsx` 和 `Inspector.jsx` 中更新集合。

> [!WARNING]
> **线性投影偏差**：当前权重模型假设肢体是相对笔直的片段。基础贴图中高度弯曲或“L 形”的肢体可能导致权重分布不均。

> [!NOTE]
> **Staging 反馈**：使用 `draftPose` 进行 Staging 反馈略微偏离了 `draftPose` 的原始意图（它原本仅用于动画模式）。这造成了一种依赖，即 Staging 模式的“pose”逻辑与动画 store 耦合。

## 6. 未来建议

- **骨骼分组**：实现更健壮的标签系统以替代硬编码字符串，从而支持尾部关节、颈部段等。
- **体积保持**：当前的线性蒙皮在 180 度弯曲时会产生“糖纸（candy-wrapper）”效应。在 JS 中实现双四元数蒙皮（DQS）可以解决此问题，尽管其复杂度显著更高。

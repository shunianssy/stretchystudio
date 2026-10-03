# PSD 导入向导实现

本文档详述 Stretchy Studio 中 3 步 PSD 导入向导的架构与工作流程。

## 概述
PSD 导入流程已从直接的“映射到绑定”流程演进为一个多阶段向导。这使用户有机会在计算骨骼层级与父子逻辑*之前*修正图层顺序。

## 3 步工作流程

### 🟢 步骤 1：检查映射（`review`）
- **目的**：校验图层标签（头部、身体、手臂等）并处理手臂拆分。
- **工作流程**： 
    - 用户按需切换“Split Arms”。
    - 点击 **Continue** 进入步骤 2。
- **触发**：`CanvasViewport.jsx` 中的 `handleWizardReorder`。

### 🟡 步骤 2：重排图层（`reorder`）
- **目的**：修正画布上的图层叠放问题。
- **HUD 变化**：
    - **Canvas**：角色被载入项目但尚未绑定。由于 `nodes.length > 0`，侧边栏会出现。
    - **Layer Panel**：“Groups” 标签页被隐藏，仅保留 “Draw Order”。
    - **Inspector**：右侧边栏被隐藏，以最大化工作区。
    - **Mode Toggle**：Staging/Animation 切换被移除。
- **工作流程**：
    - 用户在 Layer Panel 中重新排列图层。
    - 点击 **Next: Adjust Joints** 进入步骤 3。
- **触发**：`PsdImportWizard.jsx` 中的 `handleRigManually`（它会调用 `onApplyRig`）。

### 🟠 步骤 3：调整关节（`adjust`）
- **目的**：重新定位骨骼轴心。
- **工作流程**：
    - 绑定启发式算法基于*当前*图层顺序计算骨架和组分配。
    - 项目中已有的节点会以新的父级和绘制顺序被更新。
    - 用户拖动关节；点击 **Finish Setup** 完成导入。
- **触发**：`CanvasViewport.jsx` 中的 `handleWizardApplyRig`。

---

## 技术细节

### 状态管理
- **`wizardStep`**：集中存放于 `src/store/editorStore.js`。这使应用程序布局（`EditorLayout.jsx`）和 `LayerPanel.jsx` 能够通过隐藏/显示元素来响应设置阶段。
- **`wizardPsd`**：`CanvasViewport.jsx` 中的局部状态，保存原始 PSD 元数据（图层、尺寸），直至绑定完成。

### 无绑定与导入后绑定
- **步骤 2（无绑定）**：使用 `finalizePsdImport` 的一个特化版本，跳过组创建与父子关系建立。这会用原始的部件节点“填充”引擎。
- **步骤 3（应用绑定）**：基于当前标签与顺序计算骨架，然后遍历*已经激活*的项目节点，分配 `parent` 并更新 `draw_order`。

### UI 与 UX 打磨
- **自动居中**：`CanvasViewport.jsx` 对 `wizardStep` 使用一个 `useEffect`，在进入步骤 2 或 3 时将视图居中，并延迟 100ms 以等待布局变化。
- **流光条（Shimmer Bar）**：在浮动工具栏顶部的一条细条上应用循环的 `animate-shimmer` 效果，以确保周期性的可见性和聚焦。
- **按钮动画**：主要操作（“Next”、“Finish”）使用延迟的缩放进入动画以吸引注意力。

## 组件地图
- **`PsdImportWizard.jsx`**：管理步骤状态、UI 工具栏，并触发绑定逻辑。
- **`CanvasViewport.jsx`**：处理底层的项目变更与视口变换。
- **`EditorLayout.jsx`**：在向导步骤激活期间处理应用级 HUD 隔离。
- **`LayerPanel.jsx`**：根据当前向导阶段过滤可用标签页。
- **`editorStore.js`**：存储当前步骤以供全局协调。

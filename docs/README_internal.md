# 🧬 Stretchy Studio

**Stretchy Studio** 是一款为插画师和动画师设计的高性能 2D 动画工具。它简化了从静态 2D 美术作品（PSD/PNG）到完整实现的、可网格变形的动画与精灵表的整个工作流程。

与传统的基于骨骼的系统不同，Stretchy Studio 专注于**时间轴优先、直接变形的工作流程**，令人联想到 After Effects，在保持专业级灵活性的同时降低了学习门槛。

![Project Status](https://img.shields.io/badge/Status-M5_Complete-success?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Stack-React_|_WebGL2_|_Zustand-blue?style=for-the-badge)

---

## 🔗 链接

- **🚀 启动应用**：[editor.stretchy.studio](https://editor.stretchy.studio)
- **💬 Discord**：[加入我们的社区](https://discord.com/invite/zB6TrHTwAb)
- **💻 GitHub**：[mangoLion/stretchystudio](https://github.com/mangoLion/stretchystudio)
- **🌐 落地页**：[stretchy.studio](https://stretchy.studio)（或本地 `/landing/index.html`）

---

## ✨ 核心功能

### 📂 智能导入
- **PSD 图层提取**：完整支持多图层 PSD 文件，保留图层名称、顺序和不透明度。
- **角色格式检测**：智能识别 23+ 种角色部件标签（例如 *eyebrow_L*、*topwear*、*footwear*）。自动将图层组织为结构化的 **Head**（含 **Eyes** 子组）、**Body**（含 **Upper/Lowerbody**）和 **Extras** 层级，同时保留原始 PSD 绘制顺序。
- **按需网格（Mesh-on-Demand）**：从轻量级贴图开始；在需要时可选择启用低多边形网格生成以进行高级变形（默认值：Alpha Threshold 5、Smooth Passes 0）。

### 📐 精确绑定
- **层级变换**：具有父子变换继承的嵌套组结构。
- **直观 Gizmo**：用于直接在画布上操作的世界空间移动和旋转手柄；动画时间轴上可旋转的骨骼弧线。
- **3 步导入向导**：在手动（启发式）或 AI 驱动（DWPose）绑定之间选择，然后在提交前于画布上调整关节。
- **骨架自动绑定**：两种骨架检测方法：
  - **手动（启发式）**：从图层包围盒即时估算骨架 —— 无需下载模型。
  - **DWPose ONNX**：针对 see-through PSD 角色的高精度全身姿态检测。
- **关节调整**：全画布骨架叠加层，带可拖动的关节圆圈。在完成前随时可按 Back 按钮回退到上一个向导步骤。
- **骨骼层级**：基于关节的骨骼作为组节点，使用 pivotX/Y 定位（root → torso → head → eyes；腿部；带肘/膝关节的手臂）。
- **2D 虹膜触控板**：专用于直观虹膜/眼球移动的 2D 方形触控板 UI；最优地锚定在头部上方以避免遮挡面部。
- **肢体弯曲（肘/膝）**：针对手臂和腿部的逼真 2D 顶点蒙皮。通过将顶点投影到骨骼轴上来自动计算骨骼权重。与直接旋转手柄无缝配合。
- **自动虹膜裁剪**：高级的基于模板（stencil）的遮罩使虹膜保持在眼白范围内。智能 L/R 匹配通过名称后缀检测，开箱即用地处理拆分眼睛的角色。
- **轴心校准**：精确的轴心放置，以实现自然的旋转和缩放。
- **选择隔离**：当骨架处于激活状态*且*存在绑定时，选择和 Gizmo 会自动锁定/隐藏，以专注于骨骼关节设置。对于未绑定的项目，标准选择保持启用。
- **基于 Alpha 的选择**：像素级精确的选择，对带贴图的四边形和复杂网格都能即时生效。
- **形态键（混合变形）**：受 Blender 启发的顶点增量系统。创建多种网格变体（例如 “Mouth Open”、“Angry Eye”），并使用影响强度滑块（0.0–1.0）以叠加方式混合它们。
  - **基于增量**：存储相对于静止位置的偏移，使形态独立于 Staging 模式的变形。
  - **直接笔刷编辑**：在专门的 “Edit Mode”（铅笔图标）中使用变形笔刷，直接在画布上雕刻形态。
  - **实时累积预览**：在混合多个形态时实时更新画布。
- **行内帮助系统**：可复用的 `HelpIcon` 组件为整个 UI（Inspector、Timeline、Rigging Wizard 和 Mode Toggles）中的复杂参数提供即时工具提示。

### 🎬 专业时间轴
- **AE 风格工作流程**：熟悉的变换（X、Y、Rotation、Scale）和网格顶点关键帧系统。
- **动态默认值**：默认启用 **Auto Keyframe**（属性变化时自动创建关键帧）和 **Loop Keyframes**（在首尾关键帧之间无缝循环）。
- **多片段管理**：在单个项目内创建多个动画序列（例如 *Idle*、*Walk*、*Attack*）。
- **直接顶点关键帧**：通过为单个网格顶点制作动画来“Warp”你的插画，实现有机运动。
- **形态键轨道**：随时间平滑地动画化混合形态影响强度。轨道支持标准缓动以及自动清理冗余的 `mesh_verts` 关键帧。
- **平滑插值**：高性能渲染循环，带实时姿态混合。

### 📤 多样化导出
- **PNG/WEBP/JPG 序列**：高性能的逐帧导出，支持自定义缩放、帧率和背景选项（Transparent/Solid/Grid）。
- **单帧导出**：将当前时间轴状态捕获为高分辨率图像，并带专门的帧索引滑块。
- **Spine 4.0 JSON**：面向游戏引擎的工业级导出。将 Stretchy Studio 的层级、设置姿态和动画时间轴（Translate、Rotate、Scale、Opacity）映射到 Spine 4.0 schema。包含自动图像打包和技术性坐标映射（Y-up 转换）。

### ⚡ 优化的引擎
- **WebGL2 渲染器**：使用 VAO、批处理和层级矩阵数学的自定义渲染管线，实现 60 FPS 性能。
- **姿态分离**：播放状态与项目模型解耦，确保非破坏性的动画工作流程。
- **低内存占用**：高效的贴图和顶点缓冲管理。

---

## 🛠 技术栈

- **核心**：[React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **状态管理**：[Zustand](https://github.com/pmndrs/zustand) + [Immer](https://immerjs.github.io/immer/)
- **渲染**：[WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext)、[gl-matrix](http://glmatrix.net/)
- **网格引擎**：[Delaunator](https://github.com/mapbox/delaunator)（三角剖分）、自定义轮廓追踪
- **IO**：[ag-psd](https://github.com/misonou/ag-psd)（PSD 解析）、[JSZip](https://stuk.github.io/jszip/)（导出）
- **样式**：[Tailwind CSS](https://tailwindcss.com/)、[Radix UI](https://www.radix-ui.com/)、[Lucide React](https://lucide.dev/)

---

## 🏗 项目结构

```bash
src/
├── app/layout/          # 4-zone UI layout (Canvas, Layers, Inspector, Timeline)
├── components/
│   ├── canvas/          # WebGL Viewport, Gizmos, and Picking logic
│   ├── layers/          # Hierarchical draw order and grouping management
│   ├── inspector/       # Node properties and mesh generation controls
│   └── timeline/        # Playhead, Keyframe tracks, and Animation CRUD
├── renderer/
│   ├── transforms.js    # Matrix math & world matrix composition
│   ├── scenePass.js     # Hierarchical draw-order rendering
│   └── partRenderer.js  # GPU buffer management (VAO/EBO)
├── store/
│   ├── projectStore.js  # Scene tree and persistent node state
│   ├── animationStore.js # Playback state, interpolation, and pose overrides
│   └── editorStore.js   # UI state, selection, and viewport settings
├── mesh/                # Auto-triangulation and mesh editing algorithms
└── io/                  # PSD parsing and export utilities
```

---

## 🚀 快速开始

### 前置条件

- [Node.js](https://nodejs.org/)（v18+）
- [pnpm](https://pnpm.io/)（推荐）或 `npm`

### 设置

1. **安装依赖**：
   ```bash
   pnpm install
   ```

2. **运行开发服务器**：
   ```bash
   pnpm dev
   ```

3. **打开浏览器**：
   访问 `http://localhost:5173`。

---

## 🎨 工作流程示例

### 静态角色
1. **导入**：将 PSD 拖入视口。
2. **组织**：使用 Groups 标签页将图层设为父子关系并调整轴心点。
3. **网格**：选择一个部件，点击 “Generate Mesh”，并按需调整网格设置。
4. **动画**：切换到 “Animation” 模式，创建新片段，并为变换 + 顶点制作关键帧。
5. **导出**：（即将推出）导出为打包的精灵表或 PNG 序列。

### 已绑定角色（See-Through PSD）
Stretchy Studio 针对 [**See-Through**](https://github.com/shitagaki-lab/see-through) 管线（[论文](https://arxiv.org/abs/2602.03749)）进行了高度优化。它将单张动漫插画转换为分层 PSD，Stretchy Studio 随后可对其自动绑定。

#### 如何获取分解后的 PSD
- **推荐**：[免费 Hugging Face Demo](https://huggingface.co/spaces/24yearsold/see-through-demo)（最快捷）
- **进阶**：[See-through 仓库](https://github.com/shitagaki-lab/see-through) 或 [Windows WebUI](https://github.com/BeamManP/see-through-webui)

> [!NOTE]
> **风格兼容性**：See-Through 专门针对 **动漫/VTuber** 风格训练。写实风格可能无法正确分解。

1. **导入与绑定**：拖入 see-through PSD 角色 → 打开 3 步向导：
   - 选择绑定方法：*Rig manually*（即时启发式）或 *Rig with DWPose*（AI 驱动）
   - 按需在画布上调整关节位置
   - 点击 Finish 提交
2. **动画**：切换到 “Animation” 模式，创建片段，并为骨骼旋转 + 顶点变形制作关键帧。
3. **播放**：骨骼通过顶点蒙皮驱动肢体弯曲；关键帧之间平滑插值。
4. **导出**：导出为精灵表

---

## 📜 元数据

- **作者**：Nguyen Phan
- **许可证**：私有 / 专有
- **版本**：0.6.0（Spine Export Release）

# Stretchy Studio

为「See-Through」SOTA 角色模型进行绑定与动画制作的 2D 工具。

Stretchy Studio 是一款基于 WebGL 的高性能 2D 动画工具，用于把静态图层转化为网格变形动画。它面向「AI 图层分解（如 See-Through SOTA 模型）」与「动画制作」之间的衔接流程：导入分解完成的 PSD，自动建立骨架，然后直接在时间轴上制作动画。

与传统基于骨骼的系统不同，Stretchy Studio 将自动绑定与「以时间轴为先、直接变形」的工作流结合在一起，可以在数秒内把一张平面 PSD 变成完整绑定的角色。

- 在线编辑器：https://editor.stretchy.studio
- 官网：https://stretchy.studio
- Discord：https://discord.com/invite/zB6TrHTwAb

---

## 主要功能

### 原生支持 See-Through 分解结果
针对通过 See-Through 等 SOTA 图层分解模型生成的角色做了优化。导入切分好的 PSD 后，Stretchy Studio 会自动处理遮挡关系、深度分层与网格生成。

### 自动绑定
使用 DWPose 姿态检测为角色自动生成骨架，或使用内置的启发式方法快速完成绑定。

### 网格变形
不局限于图层旋转，可以对单个网格顶点制作动画，实现弯曲、拉伸等有机形变，适合呼吸感、飘动的头发以及 Live2D 风格的微表情。

### 其他功能
- 自动眼部裁剪：瞳孔始终限制在眼眶内，无需额外遮罩。
- 四肢弯曲：内置面向手臂与腿部的顶点蒙皮。
- 形态键（Shape Key）：创建一次复杂变形（如微笑、眨眼），通过影响强度滑块混合。
- 音频轨道：在时间轴中叠加背景音乐与音效，并与动画同步。
- Spine 4.0 导出：把绑定与动画导出为 Spine JSON 格式，用于游戏引擎与制作流程。

---

## See-Through 工作流

Stretchy Studio 被设计为 [See-Through](https://github.com/shitagaki-lab/see-through) 模型的动画引擎。传统 2D 动画需要手工分层与补全（inpainting），而 See-Through 可以用一张静态插画自动完成这一过程。

### 什么是 See-Through

See-Through 是一个 SOTA 框架，它能把单张动漫插画分解为若干张已完整补全、语义互不重叠的身体部件图层，从而得到一个可操控的角色模型。

- 官方仓库：https://github.com/shitagaki-lab/see-through
- 学术论文：[See-through: Single-image Layer Decomposition for Anime Characters](https://arxiv.org/abs/2602.03749)

### 如何获得分解后的 PSD

推荐使用[免费的 Hugging Face Demo](https://huggingface.co/spaces/24yearsold/see-through-demo) 快速对角色运行该模型。

> See-Through 专门针对动漫与 VTuber 风格插画训练。写实或非动漫风格可能无法正确分解。

---

## 快速开始

1. 打开应用：访问 [editor.stretchy.studio](https://editor.stretchy.studio)。
2. 导入资源：把 `.stretch` 工程、PSD 或 PNG 文件拖入工作区。
3. 自动绑定：跟随设置向导，映射图层并建立角色骨架。
4. 制作动画：切换到动画模式，开始创建关键帧。

---

## 工作流示例

### 静态角色

1. 导入：把 PSD 拖入编辑器视口。
2. 整理：在「分组」标签页中为图层建立父子关系并调整轴心。
3. 网格：对任意部件点击「生成网格」，即可启用有机弯曲。
4. 动画：切换到动画模式，创建动画片段并开始打关键帧。

### SOTA 工作流（例如 See-Through）

1. 导入：把分解好的 See-Through PSD 拖入编辑器。
2. 自动绑定：启动绑定向导，用 DWPose 把图层映射到骨架结构上。
3. 微调：调整关节位置与网格密度，处理被遮挡的区域（例如脖子后方的头发）。
4. 动画：创建利用 See-Through 深度数据的多层动画。

---

## 面向开发者

### 项目结构

```bash
src/
├── app/layout/          # 四区 UI 布局（画布、图层、属性检查器、时间轴）
├── components/
│   ├── canvas/          # WebGL 视口、Gizmo 与拾取逻辑
│   ├── layers/          # 层级绘制顺序与分组管理
│   ├── inspector/       # 节点属性与网格生成控制
│   └── timeline/        # 播放头、关键帧轨道与动画增删改
├── renderer/
│   ├── transforms.js    # 矩阵运算与世界矩阵合成
│   ├── scenePass.js     # 层级绘制顺序渲染
│   └── partRenderer.js  # GPU 缓冲区管理（VAO/EBO）
├── store/
│   ├── projectStore.js  # 场景树与持久化节点状态
│   ├── animationStore.js # 播放状态、插值与姿态覆盖
│   └── editorStore.js   # UI 状态、选中项与视口设置
├── mesh/                # 自动三角化与网格编辑算法
└── io/                  # PSD 解析与导出工具
```

### 环境要求

- [Node.js](https://nodejs.org/)（v18+）
- [pnpm](https://pnpm.io/)（推荐）

### 安装与运行

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

打开 `http://localhost:5173` 即可在本地查看应用。

---

## 国际化

界面支持简体中文 / English 双语切换：

- 在编辑器顶部工具栏点击语言图标即可切换。
- 语言偏好在 `localStorage` 中持久化；首次访问会根据浏览器语言自动选择。
- 文案集中在 `src/i18n/locales/{en,zh}/` 下，按命名空间（`common`、`editor`、`panels`、`timeline`、`io`、`canvas`）拆分维护。新增文案请在对应的 `en` 与 `zh` 文件中同步添加相同键。

组件内使用方式：

```js
import { useTranslation } from '@/i18n';

function MyButton() {
  const { t } = useTranslation();
  return <button title={t('editor.topBar.saveProject')}>{t('common.save')}</button>;
}
```

---

## 社区与支持

加入 [Discord](https://discord.com/invite/zB6TrHTwAb)，分享动画、获取帮助或提出功能建议。

---

## 许可协议

本项目基于 MIT 许可证授权，详见 [LICENSE](LICENSE) 文件。
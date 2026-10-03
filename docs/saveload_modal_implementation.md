# 保存/载入项目弹窗与资源库实现

本文档详述专业化项目资源库（Project Library）系统的实现，它将工作流程从基础的文件下载演进为持久化、可视化且可管理的基于浏览器的仓库。

## 概述
“Project Library” 提供了一个集中式工作区，使用 **IndexedDB** 在浏览器内管理 `.stretch` 项目。它具备可视化缩略图、智能覆盖以及一整套管理工具（重命名、复制、删除、下载）。

## 1. 持久化层（`[projectDb.js](file:///w:/shared/ReactProjects/stretchystudio/src/io/projectDb.js)`）
一个用于 IndexedDB 的工具封装，负责管理项目记录。
- **自动捕获**：在每次保存到资源库时，使用离屏缓冲捕获 WebGL 画布的 WebP 缩略图。
- **CRUD 操作**：
  - `saveToDb`：Upsert（插入或更新）一条项目记录（blob + 缩略图 + 元数据）。
  - `deleteProject`：删除一条记录。
  - `updateProjectName`：重命名项目而无需重新保存整个 blob。
  - `duplicateProject`：以新 ID 和 “ (Copy)” 后缀克隆一条项目记录。

## 2. 共享组件：`[ProjectGallery](file:///w:/shared/ReactProjects/stretchystudio/src/components/load/ProjectGallery.jsx)`
一个高性能、可复用的画廊组件，供载入和保存两个弹窗共同使用。
- **特性**：
  - **操作悬浮层**：将鼠标悬停在项目卡片上会显示 **Rename**、**Duplicate**、**Download** 和 **Delete** 图标。
  - **行内重命名**：使用局部切换状态，将标题替换为输入框，以进行即时重命名。
  - **网格布局**：响应式 CSS 网格，可自适应弹窗宽度。
  - **独立滚动**：设计为放置在 `ScrollArea` 内，使资源库可扩展至数百个项目，同时保持弹窗头部固定。

## 3. UI 优化

### 载入项目弹窗
- **统一界面**：移除了独立的 “Import” 面板。
- **将导入作为卡片**：画廊中的第一项是一张专门的 **Import Project** 卡片。这使所有“入口”操作都统一在同一套视觉网格中。
- **固定头部**：“Project Library” 标题被固定，画廊在其下方滚动。

### 保存项目弹窗
- **智能覆盖检测**：当用户在 “Save” 输入框中键入名称时，弹窗会检查资源库中的项目。若检测到名称冲突，工作流程会自动转向一个 **Overwrite Confirmation** 对话框。
- **显式画廊覆盖**：单击画廊中的任意项目卡片都会触发一个确认对话框，以用当前工作区覆盖该特定记录。
- **极简化清理**：移除了多余的 “Cancel” 按钮和页脚，改为依赖标准背景遮罩和 Escape 键来关闭。

## 4. 会话与工作区逻辑（`[EditorLayout.jsx](file:///w:/shared/ReactProjects/stretchystudio/src/app/layout/EditorLayout.jsx)`）

### 锚定（Anchoring）
编辑器会跟踪 `currentDbProjectId`。 
- 从资源库载入会将会话“锚定”到该 ID。
- 在锚定状态下保存，会将保存目标默认为该特定资源库记录。
- 重置项目会“解除锚定”会话。

### 新建项目工作流程
保存按钮旁边有一个专门的 **New Project** 按钮，用于开启全新工作。
- **安全性**：如果场景中包含节点，一个 `AlertDialog` 会通过要求确认来防止意外丢失。
- **干净重置**：不仅清空 store，还会在 GPU 上显式调用 `parts.destroyAll()`，以在项目会话之间对 WebGL 上下文进行防泄漏处理。

---

## 技术规格
- **数据库**：IndexedDB（原生）
- **缩略图**：4:3 WebP（Data URL）
- **压缩**：JSZip（用于 `.stretch` blob）
- **图标**：Lucide-react
- **对话框**：Radix UI / shadcn

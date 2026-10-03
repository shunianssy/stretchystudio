# 导出功能实现

## 概述

导出功能让用户可以将动画帧渲染为图像序列或单帧，格式为 PNG、WEBP 或 JPG，并通过 File System Access API 输出到 ZIP 文件或系统文件夹。

**状态**：完成（M6 功能）  
**实现日期**：2026-04-12  
**修改文件数**：5 | **新建文件数**：2

---

## 架构

### 导出管线

```
EditorLayout
  ├── captureRef (imperative ref)
  └── ExportModal (controlled modal)
        └── captureRef.current({ animId, timeMs, ... })
              └── CanvasViewport.captureExportFrame()
                    ├── Set canvas.width/height to export dims
                    ├── Render with scenePass.draw(exportMode=true)
                    ├── Composite background if needed
                    └── Return canvas.toDataURL()
        └── exportFrames({ frames, format, exportDest })
              ├── exportToZip() → JSZip → download
              └── exportToFolder() → File System Access API
```

### 关键设计决策

#### 1. WebGL 上下文标志（CanvasViewport.jsx:167）

```javascript
getContext('webgl2', {
  alpha: true,                      // Enable transparent pixels
  premultipliedAlpha: false,        // Correct alpha compositing
  stencil: true,                    // Existing iris clipping
  preserveDrawingBuffer: true,      // Allow toDataURL() outside rAF
})
```

**理由**： 
- `alpha: true` 使导出的帧可以真正透明（对 PNG/WEBP 至关重要）
- `preserveDrawingBuffer: true` 确保 `canvas.toDataURL()` 能捕获已渲染的帧
- 背景着色器继续绘制不透明背景（正常渲染时无视觉变化）

#### 2. 导出期间的画布尺寸调整

**问题**：改变 `canvas.width/height` 会清空绘制缓冲。我们需要以导出分辨率渲染，同时不破坏实时视口。

**解决方案**： 
1. 直接设置 `canvas.width = exportWidth`、`canvas.height = exportHeight`
2. 向 `scenePass.draw()` 传入 `skipResize: true`，以绕过基于 CSS 的尺寸调整逻辑
3. 使用导出参数渲染
4. 用 `canvas.toDataURL()` 捕获（同步，配合 `preserveDrawingBuffer` 可用）
5. 标记 `isDirtyRef = true` —— 下一个 rAF tick 的 scenePass 会看到 `canvas.width !== canvas.clientWidth`，并恢复到视口尺寸

**为何可行**：rAF 回调会在下一个 tick 通过 CSS 守卫调整尺寸，因此无需手动恢复。

#### 3. 透明背景处理

**用于透明导出**：
- 向导出项目传入 `bgEnabled: false`
- 在 scenePass.draw() 中设置 `exportMode: true`
- scenePass 清空为透明（rgba 0,0,0,0）并跳过 bgRenderer
- 结果：画布中为透明像素

**用于纯色背景导出**：
- 以 `exportMode: true` 渲染（透明画布）
- 合成到 2D 离屏画布上：
  ```javascript
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(glCanvas, 0, 0);
  dataUrl = off.toDataURL();
  ```
- **优势**：无需改动 BackgroundRenderer，JPG 格式也可用（无透明空洞）

---

## 修改的文件

### 1. `src/renderer/scenePass.js`

**更改**：为 `draw()` 方法添加可选的 `exportMode` 和 `skipResize` 参数

```javascript
draw(project, editor, isDark = true, poseOverrides = null, { skipResize = false, exportMode = false } = {})
```

**关键修改**：
- 若 `skipResize: true` 则跳过画布尺寸调整（保留导出尺寸）
- 若 `exportMode: true` 则清空为透明
- 若 `exportMode: true` 则跳过 bgRenderer 调用

**第 88 行**：方法签名  
**第 92-96 行**：尺寸调整守卫被 `!skipResize` 检查包裹  
**第 109-111 行**：透明清空 + 条件性 bgRenderer

---

### 2. `src/components/canvas/CanvasViewport.jsx`

**更改**：WebGL 上下文、captureRef prop、帧捕获逻辑

**第 116 行**：向组件 props 添加 `captureRef`

**第 167 行**：更新 WebGL 上下文选项：
```javascript
// Before: { alpha: false, stencil: true }
// After:  { alpha: true, premultipliedAlpha: false, stencil: true, preserveDrawingBuffer: true }
```

**第 1691-1770 行**：`captureExportFrame` 函数
- 将画布调整为导出尺寸
- 构建 zoom=1、无叠加层的模拟编辑器
- 通过 `computePoseOverrides()` 计算特定动画时间的姿态
- **新增**：为导出帧手动计算混合变形网格变形
- **新增**：在渲染前通过 `uploadPositions()` 将变形后的网格顶点上传到 GPU
- 调用 `scenePass.draw(exportProject, exportEditor, isDarkRef.current, poseOverrides, { skipResize: true, exportMode: true })`
- 按需合成背景色
- **新增**：将原始网格位置恢复到 GPU，以保持场景完整性
- 返回 data URL（PNG、WEBP 或 JPG）
- 标记 dirty 以便 rAF 恢复

**第 1359-1360 行**：用于将 `captureExportFrame` 赋给 `captureRef.current` 的 useEffect

---

### 3. `src/app/layout/EditorLayout.jsx`

**更改**：下载按钮、导出弹窗状态、captureRef 接线

**第 14 行**：向 lucide-react import 添加 `Download`

**第 15 行**：导入 `ExportModal` 组件

**第 63-64 行**：添加 `captureRef` 和 `exportModalOpen` 状态

**第 180-191 行**：工具栏中的下载按钮（位于 Load 按钮之后）

**第 418 行**：向 CanvasViewport 传入 `captureRef`

**第 476-481 行**：渲染 ExportModal 并接线状态

---

## 新建的文件

### 4. `src/io/exportAnimation.js`

核心导出逻辑：帧规格、边界计算、ZIP/文件夹写入。

**导出的函数**：

#### `computeExportFrameSpecs({ type, animsToExport, exportFps, frameIndex })`
返回 `[{ animId, animName, frameIndex, timeMs }, ...]`
- **序列**：为每个动画生成 `Math.round(duration/1000 * fps)` 帧
- **单帧**：每个动画在 `frameIndex/fps` 毫秒处生成一个条目

#### `computeAnalyticalBounds(project)`
计算所有可见部件的世界空间包围盒。
- 使用 transforms.js 中的 `computeWorldMatrices()` 和 `computeEffectiveProps()`
- 变换每个部件图像边界的 4 个角
- 返回 `{ x, y, width, height }` 或 `null`
- 用于 'min_image_area' 导出选项

#### `resolveAnimations(animations, animTarget, activeAnimationId)`
解析要导出哪些动画：
- `'current'` → 激活动画或第一个动画
- `'all'` → 所有动画
- 特定 ID → 该动画

#### `exportFrames({ frames, format, exportDest, onProgress })`
主导出编排器。
- 委托给 `exportToZip()` 或 `exportToFolder()`
- 调用 `onProgress(message)` 以更新 UI

#### `exportToZip(frames, ext, onProgress)`
使用动态导入 `jszip`：
```javascript
const { default: JSZip } = await import('jszip');
const zip = new JSZip();
zip.folder('animName').file(`frame_0001.${ext}`, blob);
zip.generateAsync({ type: 'blob' });
// Download via <a> element
```

#### `exportToFolder(frames, ext, onProgress)`
使用 File System Access API：
```javascript
const dirHandle = await window.showDirectoryPicker();
const subDir = await dirHandle.getDirectoryHandle('animName', { create: true });
const fileHandle = await subDir.getFileHandle('frame_0001.ext', { create: true });
const writable = await fileHandle.createWritable();
await writable.write(blob);
```

**辅助函数**：`sanitizeName(name)` —— 将非字母数字字符替换为 `_`

---

### 5. `src/components/export/ExportModal.jsx`

带有表单控件与导出编排的完整弹窗 UI。

**状态**：
- Type：sequence | single_frame
- Format：png | webp | jpg
- Animation target：current | specific | all
- Export FPS（仅序列）或 frame index（单帧）
- Image contains：canvas_area | min_image_area | custom
- Output scale：1-400%
- Background：transparent | custom color
- Export destination：zip | folder

**关键特性**：
- 打开时从 store 同步默认值
- 若 window 中不存在 `'showDirectoryPicker'`，则禁用文件夹选项
- 显示 JPG + 透明的警告
- 导出期间显示进度条（当前/总帧数）
- 取消按钮（导出期间禁用）

**导出流程**：
1. 解析要导出的动画
2. 通过 `computeExportFrameSpecs()` 计算帧规格
3. 计算导出尺寸（画布区域、最小区域或自定义）
4. 遍历帧规格：
   - 调用 `captureRef.current({ animId, timeMs, ... })`
   - 更新进度
   - 让出给浏览器（setTimeout）
5. 将所有帧数据传给 `exportFrames()`
6. 关闭弹窗

---

## 用法

### 最终用户流程

1. **打开导出弹窗**：点击工具栏中的 Download 图标
2. **配置导出**：
   - 选择 Type（Sequence / Single Frame）
   - 选择 Format（PNG / WEBP / JPG）
   - 选择 Animation（Current / 特定 / All）
   - 设置 FPS（序列）或 Frame index（单帧）
   - 选择 Image Contains（Canvas area / Min / Custom）
   - 调整 Output Scale（%）
   - 选择 Background（Transparent / Custom color）
   - 选择 Export Destination（ZIP / Folder）
3. **导出**：点击 Export 按钮
4. **等待**：进度条显示当前帧 / 总帧数
5. **下载**：ZIP 下载或文件夹写入系统

### 程序员集成

如果要添加新的导出选项（例如元数据、命名约定）：

1. **添加到 ExportModal 状态**：新表单字段
2. **传给 captureRef**：包含在 `captureRef.current({ ... })` 调用中
3. **在导出的文件函数中使用**：`exportFrames()` 接收所有帧数据 + 元数据

示例：为文件名添加自定义前缀：
```javascript
// In ExportModal:
const [filePrefix, setFilePrefix] = useState('anim');

// In handleExport:
frameDataItems.push({ ..., filePrefix });

// In exportAnimation.js:
const filename = `${filePrefix}_frame_${frameIndex}.${ext}`;
```

---

## 已知局限与未来工作

### 当前局限

1. **GIF 格式**：不支持（无浏览器原生 GIF 编码）。之后可通过 `gifenc` 或 `gif.js` 库添加。

2. **自定义裁剪**：“Custom” image contains 选项没有用于拖动裁剪边界的可视化 UI。用户必须选择 “Custom”，但尺寸默认使用画布区域。

3. **JPG + 透明**：会自动以黑色背景渲染（因为 JPG 没有 alpha）。用户会看到警告。

4. **最小图像区域**：从部件边界分析计算得出。不考虑仅 alpha 的像素（例如图像边界外的柔和阴影）。

### 未来增强

- [ ] 自定义裁剪 UI（在画布预览中拖动边界）
- [ ] 通过库导出 GIF
- [ ] 批量导出预设（保存/载入常用配置）
- [ ] 精灵表网格布局（替代单独文件）
- [ ] 每帧的元数据 JSON（变换、可见性等）
- [ ] 导出特定帧范围（起始/结束帧）
- [ ] 交错 PNG / 渐进式 JPEG 选项

---

## 技术说明

### 为什么使用 `preserveDrawingBuffer: true`？

`preserveDrawingBuffer: false`（默认）允许浏览器通过立即交换前后缓冲来优化。为 false 时，`canvas.toDataURL()` 可能返回上一帧或垃圾数据。

`preserveDrawingBuffer: true` 告诉 WebGL 保持渲染缓冲可供 CPU 回读（例如 `toDataURL()`、`getImageData()`）。有轻微性能开销，但对于在 rAF tick 之外捕获帧是必需的。

### 为什么使用 `alpha: true` 和 `premultipliedAlpha: false`？

WebGL 上下文默认 `alpha: false` 意味着画布完全不透明。渲染缓冲的 alpha 通道被忽略。

使用 `alpha: true, premultipliedAlpha: false`：
- 画布可以有透明区域
- `toDataURL('image/png')` 正确编码 alpha 通道
- 在 `<canvas>` 背景上的合成遵循标准（非预乘）alpha 规则

### 为什么要通过 2D 画布合成背景？

**方案 1**：修改 BackgroundRenderer 以按需绘制  
**问题**：复杂，破坏关注点分离

**方案 2**：当 `bgEnabled: true` 时更改 WebGL 清空颜色  
**问题**：无法处理非纯色背景（渐变、图案）

**我们的方法**：先渲染为透明，再在 2D 中合成  
**优势**：简单，适用于所有背景类型，不触碰 ScenePass

### 画布尺寸恢复

在导出捕获后，我们不手动恢复 `canvas.width` 和 `canvas.height`。而是：

1. 设置 `isDirtyRef.current = true`
2. 下一个 rAF tick 调用不带 `skipResize` 的 `scenePass.draw()`
3. 尺寸调整守卫看到 `canvas.width (exportWidth) !== canvas.clientWidth (viewportWidth)`
4. 设置 `canvas.width = canvas.clientWidth` → 视口尺寸被恢复
5. 以正确的视口尺寸渲染

**为什么不手动恢复？** 因为 `canvas.width = x` 本身会清空缓冲。如果我们在 `captureExportFrame` 中这么做，会清空刚刚捕获的帧。让 rAF 处理更安全。

---

## 测试清单

- [ ] 单帧 PNG 导出（透明背景）
- [ ] 以 24 FPS 导出序列 PNG
- [ ] 以自定义颜色背景导出序列 WEBP
- [ ] 导出 JPG（验证透明背景时出现警告）
- [ ] 多动画 —— All + ZIP
- [ ] 多动画 —— Specific + Folder（若 FSAPI 可用）
- [ ] 输出缩放 50% —— 验证尺寸减半
- [ ] 最小图像区域 —— 验证包围盒比画布更紧凑
- [ ] 导出期间进度条更新
- [ ] 导出完成后实时视口正确渲染
- [ ] ZIP 文件结构：`{animName}/frame_0001.png` 等
- [ ] 文件夹结构与 ZIP 一致
- [ ] JPG 质量在 0.92 时看起来可接受

---

## 调试

### 常见问题

**导出按钮无反应**：
- 检查 `captureRef.current` 是否已赋值（useEffect 应已运行）
- 验证 sceneRef 存在（ScenePass 已初始化）
- 打开开发者控制台查看错误

**导出的帧是空白/白色**：
- 检查 WebGL 上下文是否有 `alpha: true`（PNG 中应看到透明）
- 验证姿态计算没有裁剪掉所有节点
- 检查导出时的画布尺寸是否正确设置

**ZIP 下载未开始**：
- 验证 JSZip 导入是否工作（检查网络标签页）
- 确认至少捕获了一帧
- 检查 blob URL 创建以及 `<a>` 点击是否触发

**文件夹导出静默失败**：
- File System Access API 在生产环境需要 HTTPS
- Firefox 不支持 showDirectoryPicker
- 用户取消了文件夹选择器（已捕获并记录）

### 调试输出

在 `captureExportFrame` 中启用控制台日志：
```javascript
console.log('[Export] Rendering frame', spec.frameIndex, 'at', timeMs, 'ms');
console.log('[Export] Canvas size:', canvas.width, 'x', canvas.height);
```

在 `exportAnimation.js` 中启用：
```javascript
console.log('[Export] Frame specs:', frameSpecs);
console.log('[Export] Bounds:', computeAnalyticalBounds(project));
```

---

## Bug 修复

### 网格变形关节导出（2026-04-16）

**问题**：导出的 PNG 帧与应用中显示的内容不一致。具体来说，网格变形关节（混合变形）在导出中未正确显示。

**根因**：在网页上播放动画时，代码会调用 `sceneRef.current.parts.uploadPositions()` 在渲染前将变形后的网格顶点上传到 GPU。然而，在导出帧捕获函数中完全缺少这一步骤，而且变形逻辑本身只运行在主 `tick()` 循环中。

**解决方案**：向 `captureExportFrame()` 添加完整的网格顶点上传和恢复逻辑：
1.  针对特定帧时间手动计算混合变形。
2.  在调用 `scene.draw()` 前将变形后的网格顶点上传到 GPU。
3.  帧捕获完成后恢复原始网格位置。

---

## 文件摘要

| 文件 | 类型 | 更改 | 行号 |
|------|------|---------|-------|
| scenePass.js | 修改 | 添加 exportMode + skipResize | 88, 92-96, 109-111 |
| CanvasViewport.jsx | 修改 | WebGL context、captureRef、captureExportFrame | 116, 167, 1289-1360 |
| EditorLayout.jsx | 修改 | 下载按钮、captureRef、ExportModal | 14, 15, 63-64, 180-191, 418, 476-481 |
| exportAnimation.js | 新建 | 导出管线（specs、bounds、ZIP、Folder） | 150 lines |
| ExportModal.jsx | 新建 | 弹窗 UI + 编排 | 320 lines |

**总新增**：~550 行  
**总修改**：~30 行

---

## 参考

- [MDN: HTMLCanvasElement.toDataURL()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL)
- [MDN: WebGL2RenderingContext](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext)
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [JSZip Documentation](https://stuk.github.io/jszip/)
- [Stretchy Studio 项目结构](../README.md)

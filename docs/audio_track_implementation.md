# 音频轨道实现

## 概述

音频轨道允许用户在 Stretchy Studio 中为动画添加背景音乐或音效。音频可以裁剪、在时间轴上定位，并与动画播放精确同步。

## 功能

- ✅ 每个动画可添加多条音频轨道
- ✅ 上传音频文件（MP3、WAV 等）
- ✅ 通过拖动把手从起点/终点裁剪音频
- ✅ 沿时间轴移动音频片段
- ✅ 与动画精确同步播放
- ✅ 用于详细参数编辑的音频弹窗
- ✅ 自动裁剪到时间轴时长
- ✅ 循环支持（动画循环时音频重新开始）
- ✅ 将音频持久化到 `.stretch` 项目文件中

## 架构

### 数据模型

音频轨道存储在动画对象（`projectStore`）中：

```javascript
animation {
  id: string,
  name: string,
  tracks: [...keyframe tracks],
  audioTracks: [              // NEW
    {
      id: string,
      name: string,
      sourceUrl: string | null,       // blob URL to audio file
      mimeType: string,               // e.g. 'audio/mp3'
      audioDurationMs: number,        // total length of source file
      audioStartMs: number,           // trim: skip from start (ms)
      audioEndMs: number,             // trim: end point in audio file (ms)
      timelineStartMs: number,        // where on timeline this clip begins (ms)
    }
  ]
}
```

### 关键组件

#### `useAudioSync(animation, animStore)` —— Web Audio API 播放 Hook

位于 `TimelinePanel.jsx` 第 ~114–210 行。

**设计原则：**
- Effect 不监听 `currentTime`（会每帧 rAF 触发）→ 避免重复 fetch/decode 导致内存溢出（OOM）
- 转而使用 ref（`animationRef`、`currentTimeRef`）来始终读取最新值而不重新触发
- 只监听 `isPlaying`、`activeAnimationId` 和 `loopCount`（稳定、离散的变化）

**工作流程：**
1. **解码 effect** —— 监听 `trackSourceKey`（由 `id:sourceUrl` 对组成的字符串）
   - 每条轨道只 fetch 一次音频文件
   - 通过 Web Audio API 解码为 AudioBuffer
   - 缓存在 `buffersRef` Map 中

2. **播放/停止 effect** —— 监听 `isPlaying` + `activeAnimationId` + `loopCount`
   - 当 `isPlaying` 变为 true：从当前播放头位置启动 AudioBufferSourceNode
   - 当 `isPlaying` 变为 false：停止所有 source
   - 在播放开始的那一刻通过 ref 读取 `currentTime`（非响应式）
   - 使用 Web Audio API 的 `source.start(when, offset, duration)` 调度来实现精确计时
   - 通过 `delaySec` 参数处理未来才开始的片段

**偏移计算：**
```javascript
const offsetInAudioMs = Math.max(0, audioStartMs + Math.max(0, nowMs - timelineStartMs));
```
- `audioStartMs`：音频文件中的裁剪点
- `nowMs - timelineStartMs`：播放头已进入片段的距离
- 结果：音频文件中开始播放的精确位置

**循环处理：**
- `animationStore.loopCount` 在每次循环时递增（在 `tick()` 函数中）
- Effect 检测到递增 → 再次触发 `startAll()`
- 音频源会在其 `duration` 之后自然结束，因此无需清理

#### `AudioTrackRow` —— 单条轨道的时间轴 UI

位于 `TimelinePanel.jsx` 第 ~264–560 行。

**元素：**
- **标签列**：轨道名 + ⚙️ 设置按钮 + ✕ 删除按钮
- **轨道区域**（标签右侧）：
  - 若无音频：“Upload audio” 按钮 + 隐藏的文件输入
  - 若有音频：带拖动把手的彩色条，显示片段边界

**拖动处理器：**
- **左手柄**：从音频起点裁剪
  - `audioStartMs` 和 `timelineStartMs` 一起移动（右边缘保持固定）
  - 钳制：`audioStartMs ≥ 0`、`timelineStartMs ≥ 0`
- **右手柄**：从音频终点裁剪
  - 仅 `audioEndMs` 变化
  - 钳制：`audioStartMs + 100 ≤ audioEndMs ≤ audioDurationMs`
- **主体**：沿时间轴移动整个片段
  - 仅 `timelineStartMs` 变化
  - 使用 `xToFrame()` + `frameToMs()` 进行正确的像素→毫秒换算

**音频上传：**
- 用户点击按钮 → 打开文件输入
- 选择后：通过 AudioContext 解码音频以获取时长
- 若音频长于时间轴时长，则自动将 `audioEndMs` 裁剪至时间轴时长
- 设置 `sourceUrl`（blob URL）和 `audioDurationMs`

#### `AudioTrackModal` —— 参数编辑器

位于 `TimelinePanel.jsx` 第 ~224–263 行。

使用 shadcn 的 `Dialog` 组件以呈现精致 UI。

**参数：**
- **Timeline Start**（ms）：音频在动画时间轴上开始的位置
- **Audio Start Trim**（ms）：从音频文件开头跳过的毫秒数
- **Play Duration**（ms）：裁剪后播放的时长

包含滑块 + 数字输入以实现精确控制，并带有实时信息显示。

### 序列化

#### 保存（`projectFile.js`）

1. 在 ZIP 中创建 `audios/` 文件夹（与 `textures/` 平级）
2. 对于每条带 `sourceUrl` 的音频轨道：
   - 从 URL fetch blob
   - 从 `mimeType` 提取扩展名（例如 `'audio/mp3'` → `'mp3'`）
   - 存储为 `audios/{trackId}.{ext}`
   - 在序列化 JSON 中将 `sourceUrl` 替换为路径

#### 载入（`projectFile.js`）

1. 载入项目 JSON 之后
2. 对于每个动画中带 `source` 路径的音频轨道：
   - 从 ZIP 提取 blob
   - 通过 `URL.createObjectURL()` 创建 blob URL
   - 还原为 `sourceUrl`
   - 删除 `source` 字段

## 实现细节

### 动画 Store 变更

**新字段：**
```javascript
loopCount: 0,  // increments in tick() on each loop
```

**修改后的 `tick()` 函数：**
```javascript
if (newTime >= endMs) {
  if (s.loop) {
    newTime = startMs + ((newTime - startMs) % rangeMs);
    loopCount += 1;  // signal audio hook to restart
  }
}
set({ ..., loopCount });
```

**seek/stop 时重置：**
```javascript
seekFrame: () => set({ ..., loopCount: 0 }),
stop: () => set({ ..., loopCount: 0 }),
```

### 拖动增量计算

使用 `xToFrame()`（现有的时间轴函数）将像素位置转换为帧：
```javascript
const startFrame = xToFrame(e.clientX);        // Frame at drag start
const currentFrame = xToFrame(ev.clientX);     // Frame at current mouse
const frameDelta = currentFrame - startFrame;  // Frames moved
const deltaMs = frameToMs(frameDelta, fps);    // Convert to milliseconds
```

这确保微小的拖动产生微小的调整（而非夸张的移动）。

### 防止播放头干扰

所有音频轨道拖动处理器都会调用 `e.stopPropagation()`，以防止轨道区域的 `onPointerDown` 处理器对播放头进行跳转。

## 已知局限

1. **无波形显示** —— 仅有彩色条；没有音频内容的可视化表示
2. **播放中跳转不完美** —— 若在播放时拖动时间轴，音频不会自动重新开始
3. **无音频电平/音量控制** —— 始终通过 `AudioContext.destination` 以满音量播放
4. **单一输出目标** —— 所有音频混合到单声道输出（无声像/效果）
5. **无音频预览** —— 在进入播放模式前无法预览音频

## 未来改进

- [ ] 在音频条中显示波形可视化
- [ ] 每条轨道的音量滑块
- [ ] 声像控制（左/右立体声）
- [ ] 音频效果（淡入/淡出）
- [ ] 播放中跳转同步
- [ ] 多输出总线（后处理）
- [ ] 音频刮擦（拖动播放头时听到音频）
- [ ] 压缩器/标准化器以实现一致的响度

## 测试清单

- [ ] 上传音频文件，验证其出现在轨道中
- [ ] 拖动左/右手柄，验证片段正确裁剪
- [ ] 拖动音频条主体，验证其移动且不发生漂移
- [ ] 打开设置弹窗，使用滑块和数字输入调整参数
- [ ] 播放动画，验证音频同步播放
- [ ] 播放中暂停，音频立即停止
- [ ] 跳转到不同帧，音频正确同步
- [ ] 动画循环，音频从头重新开始
- [ ] 保存项目、重新载入，音频持久化
- [ ] 音频长于时间轴，验证上传时自动裁剪
- [ ] 多条音频轨道同时播放
- [ ] 删除音频轨道，验证其从时间轴移除

## 文件引用

- **核心实现**：`src/components/timeline/TimelinePanel.jsx`（第 1–1800 行）
- **播放 hook**：`src/components/timeline/TimelinePanel.jsx:useAudioSync`（第 ~114–210 行）
- **音频轨道行**：`src/components/timeline/TimelinePanel.jsx:AudioTrackRow`（第 ~264–560 行）
- **音频设置弹窗**：`src/components/timeline/TimelinePanel.jsx:AudioTrackModal`（第 ~224–263 行）
- **Store 变更**：`src/store/animationStore.js` 和 `src/store/projectStore.js`
- **序列化**：`src/io/projectFile.js`（saveProject, loadProject）

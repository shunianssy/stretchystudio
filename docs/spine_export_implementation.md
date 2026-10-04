# Spine 4.0 导出实现细节

本文档概述 Stretchy Studio 中 Spine 4.0 JSON 导出管线的技术实现。

## 概述
导出管线将 Stretchy Studio 的内部项目结构（节点、贴图、动画）转换为一个兼容 Spine 的 ZIP 包。ZIP 内包含 Spine / spine-godot 运行时的标准三件套：

| 文件 | 说明 |
|------|------|
| `skeleton.json` | 骨架 + 动画数据（声明 `spine: "4.0"`） |
| `skeleton.atlas` | 图集描述文件（libgdx / Spine 格式） |
| `skeleton.png` | 图集页面；多页时依次为 `skeleton2.png`、`skeleton3.png` … |

> 图集页面与数据文件同名（`skeleton.*`）是 Spine 的惯例，这样 **Spine Editor** 与 **spine-godot 运行时** 都能自动匹配数据、图集与贴图。

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

### 5. 图集（.atlas）生成与 spine-godot 兼容性
**问题**：早期版本只导出 `skeleton.json` + 每部件一张独立 PNG。**Spine Editor** 可以指向图片目录导入，但 **spine-godot 运行时**只认「`.atlas` 描述文件 + 图集页面」，缺乏 `.atlas` 时无法加载。

**解决方案**：新增图集生成模块 `src/io/spine/spineAtlas.js`：

1. 收集所有部件贴图并解码（`createImageBitmap`，回退 `<img>`）。
2. 使用**货架式（shelf）**算法把区域按 1:1 打包进 2048×2048 图集页面，装不下时自动分页。
3. 生成 `.atlas` 文本：`format: RGBA8888`、`filter: Linear,Linear`、`repeat: none`，每个区域输出 `rotate/xy/size/orig/offset/index`。
4. 导出侧**不裁剪（trim）、不缩放**，因此 `size == orig`、`offset == 0,0`。这样骨架中网格的归一化 UV（0–1，相对单张原图）会被 Spine 运行时按图集区域自动重映射，**无需在导出侧重算 UV**。
5. 贴图加载失败或尺寸超过图集页面的部件会被剔除，并从 `slots`/`skins`/插槽动画中同步移除，避免运行时报「区域/插槽不存在」。

**版本核对（重要）**：`skeleton.json` 现声明 `spine: "4.3.17"`，需搭配 **spine-godot 4.3** 运行时（运行时 `major.minor` 必须与骨架版本一致）。

> ⚠️ **更正**：早期文档曾写“使用 spine-godot 4.0.x”，这是**错误**的——上游 `spine-runtimes` 的 `4.0` 分支**根本没有 spine-godot**（最早为 4.1，且 4.1 只有引擎模块、无预编译 GDExtension）。预编译 GDExtension 从 **4.2 / 4.3** 起提供，因此目标版本定为 4.3。

### 6. 实机联调修复（Godot 4.6 + spine-godot 4.3）

以下问题是在 Godot 4.6-stable + spine-godot 4.3 GDExtension 上实际加载时暴露并修复的：

| 问题 | 现象 | 修复 |
|------|------|------|
| 部件的父节点是 warp/deformer（非 `group`），却被直接写进 `slot.bone` / `bone.parent` | 运行时 `Slot bone not found: HairBackWarp` | 新增 `resolveBoneNode()`：向上回溯到最近的 `group` 作为骨骼，找不到则用 `root`；附件偏移也改为相对该骨骼计算 |
| 形变层（warp）的动画轨道 | 时间轴引用不存在的骨骼/插槽 | 动画只处理 `group`（骨骼）与 `part`（插槽），其余类型跳过 |
| `mesh.vertices` 写成 `{x,y,restX,restY}` 对象数组 | 运行时解析崩溃（signal 11） | 拍平为 `[x0,y0,x1,y1,…]` |
| `mesh.triangles` 写成 `[[i,j,k],…]` | 运行时不识别 | 拍平为 `[i0,i1,i2, i3,i4,i5, …]` |
| 插槽 `rgba` 时间轴带 `curve` | **崩溃（signal 11）**——该预编译包对带 curve 的 rgba 时间轴存在缺陷 | 插槽 rgba 一律按线性导出（不写 `curve`）；骨骼时间轴的 `curve` 不受影响 |

### 7. 在 Godot 中加载的正确姿势

`SpineSprite.skeleton_data_res` 需要的是 **`SpineSkeletonDataResource`**（它同时持有 `atlas_res` 与 `skeleton_file_res`），而不是直接给 `.spine-json`：

```gdscript
var data := SpineSkeletonDataResource.new()
data.atlas_res = load("res://spine_export/skeleton.atlas")
data.skeleton_file_res = load("res://spine_export/skeleton.spine-json")
$SpineSprite.skeleton_data_res = data
# 骨架就绪后播放
$SpineSprite.get_animation_state().set_animation("Idle", true, 0)
```

另外：**spine-godot 只识别 `.spine-json` 扩展名**（`.json` 会被 Godot 自身的 JSON 导入器抢走），因此把导出的 `skeleton.json` 重命名为 `skeleton.spine-json` 再放入 Godot。

### 8. 第二轮实机联调修复（部件缺失 / 角色倒立）

在 Godot 中导入后，画面里只能看到零星几个部件（如一件下装 + 整个头部），其余部件完全不显示，
且可见部件上下颠倒。经过逐插槽隔离渲染 + 数据比对，定位到 **两个独立根因**：

| 问题 | 现象 | 修复 |
|------|------|------|
| **多页图集**（6 页 2048×2048） | 只有部分部件渲染，靠后页面的区域整体“消失”（逐插槽遮罩测试确认：页 4 全部未绘制） | 将图集改为 **单页**：`DEFAULT_PAGE_SIZE` 由 2048 提升到 **4096**（单页可容纳 5×5=25 个 768×768 区域）。同时修正 `.atlas` 的**页间空行分隔**（libgdx/Spine 解析器以空行判定一页结束，缺失时空行后页面会被误解析） |
| **网格顶点未做骨骼空间 + Y 翻转** | 角色整体上下颠倒；且顶点是画布绝对坐标，骨骼旋转（动画）时部件会绕画布原点乱飞 | 顶点先经「部件局部 → 骨骼局部」矩阵（`Wb⁻¹·Wp`）变换，再翻转 Y（`-y`）；附件 `x/y/rotation` 归零（几何已烘焙） |
| **`worldPivot` 取错矩阵分量** | `worldPivot` 用矩阵平移列 `m[6]/m[7]`（局部原点的像）。当节点 pivot 非零但旋转/缩放为 0 时该值恒为 0，**所有骨骼塌缩到原点**，动画会绕画布原点旋转 | 改为显式变换轴心点：`(m[0]·px + m[3]·py + m[6], m[1]·px + m[4]·py + m[7])` |

> 验证方式：把导出结果放到一个独立测试工程中，用 `SubViewport` + `Camera2D` 离屏渲染，
> 先用 `get_used_rect()` 统计非透明像素判断每个插槽是否真的有绘制，再逐帧比对。
> 修复后 22 个部件全部绘制，角色姿态正确、纹理朝向正确。

> 说明：屏幕最终呈现的位置与骨骼轴心选择无关（顶点相对骨骼、骨骼带轴心，两者相加抵消），
> 因此「显示」只依赖 Y 翻转与单页图集；而**动画的旋转中心**必须依赖正确的骨骼轴心
> （即上面的 `worldPivot` 修复）。

## 用法
1. 打开 **Export Modal**。
2. 选择 **Type: Spine (4.0+)**。
3. 点击 **Export**，得到 `spine_export.zip`。
4. 解压后目录结构为 `skeleton.json` / `skeleton.atlas` / `skeleton.png`（多页时含 `skeleton2.png` …）。
5. **Spine Editor**：`Spine menu > Import Data...`，选择 `skeleton.json`（同名的 `skeleton.atlas` 会被自动匹配）。
6. **spine-godot（Godot 4.6）**：
   1. 把 `skeleton.json` **重命名为 `skeleton.spine-json`**，与 `.atlas`、`.png` 放在同一目录；
   2. 安装 **spine-godot 4.3** GDExtension（下载地址按 `4.3/<Godot 版本 tag>/` 拼，例如 `spine-godot-extension-4.3-4.6.1-stable.zip`），解压后把 `bin/` 放到项目根目录；
   3. 参考上文第 7 节用 `SpineSkeletonDataResource` 绑定并播放动画。

> 已在本机实测通过：Godot 4.6-stable + spine-godot 4.3（4.6.1-stable 包）成功加载
> `14 bones / 22 slots / 2 animations`，`Idle` 动画可正常驱动骨骼（项目内 `spine_demo.tscn` 为最小可运行示例）。

## 相关文件

| 组件 | 文件 |
|------|------|
| 导出主流程 | `src/io/exportSpine.js` |
| 图集打包 + .atlas 文本生成 | `src/io/spine/spineAtlas.js` |
| 校验脚本 | `scripts/verify_spine_atlas.mjs` |
| UI 入口 | `src/components/export/ExportModal.jsx` |

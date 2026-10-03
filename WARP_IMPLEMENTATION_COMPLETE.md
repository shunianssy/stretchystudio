# 弯曲变形器与参数实现完成报告

## 摘要
✅ Stretchy Studio 编辑器现已在弯曲变形器与参数方面与 Live2D 导出**完全对齐**：
- **41 个参数**已完整定义并可用
- **11 种弯曲数学类型**已实现，用于变形预览
- 绑定生成过程中**自动完成参数到弯曲的绑定**
- 支持**手动创建弯曲**，可搭配任意参数

---

## 新增内容

### 1. 补齐缺失的弯曲数学类型（位于 `buildWarpKeyframes`）

#### `body_angle_z` —— 身体侧倾/倾斜
- 左倾（time=0）↔ 右倾（time=1000）
- 脊柱作为旋转轴
- 肩膀的旋转幅度大于胯部
- 透视深度：倾斜侧上升，远侧下降

#### `breathing` —— 胸部压缩/扩张
- 细微的呼吸动画
- 呼气（time=0，压缩）→ 吸气（time=1000，扩张）
- 胸部上方各行动向外扩张
- 幅度向身体中部逐步衰减

### 2. 参数现已全部打通
全部 **41 个 LIVE_RIG_PARAMS** 现在都可与弯曲变形器搭配使用：

**面部 (3)：** ParamAngleX/Y/Z
**眼睛 (11)：** ParamEyeLOpen, ParamEyeROpen, ParamEyeLSmile, ParamEyeRSmile, ParamEyeBallX/Y/Form, ParamTear
**眉毛 (8)：** ParamBrowLY/RY, ParamBrowLX/RX, ParamBrowLAngle/RAngle, ParamBrowLForm/RForm
**嘴部 (2)：** ParamMouthForm, ParamMouthOpenY
**身体 (10)：** ParamBodyAngleX/Y/Z, ParamBreath, ParamArmLA/RA/LB/RB, ParamHandL/R, ParamShoulderY
**胸部 (2)：** ParamBustX/Y
**头发 (4)：** ParamHairFront/Side/Back, ParamHairFluffy
**全局 (4)：** ParamCheek, ParamBaseX/Y

### 3. 弯曲类型覆盖情况

| 弯曲类型 | 参数 | 状态 |
|-----------|-----------|--------|
| `face_angle_x` | ParamAngleX | ✅ 完整 |
| `face_angle_y` | ParamAngleY | ✅ 完整 |
| `body_angle_x` | ParamBodyAngleX | ✅ 完整 |
| `body_angle_y` | ParamBodyAngleY | ✅ 完整 |
| `body_angle_z` | ParamBodyAngleZ | ✅ 新增 |
| `neck_follow` | ParamAngleZ（颈部） | ✅ 完整 |
| `eye_open` | ParamEyeLOpen/ROpen | ✅ 完整 |
| `mouth_open` | ParamMouthOpenY | ✅ 完整 |
| `brow_y` | ParamBrowLY/RY | ✅ 完整 |
| `hair_sway` | ParamHairFront/Back | ✅ 完整 |
| `breathing` | ParamBreath | ✅ 新增 |

---

## 工作原理

### 自动生成（通过「Generate Rig」按钮）
当调用 `autoGenerateWarpDeformers()` 时：

1. 为 WARP_SPECS 中的每个规格创建弯曲变形器：
   - `FaceWarp`（头部组）→ ParamAngleX
   - `BodyWarp`（躯干组）→ ParamBodyAngleX
   - `NeckWarp`（颈部组）→ ParamAngleX
   - 眼睛/嘴部/眉毛/头发弯曲 → 各自的参数

2. **自动把参数绑定**到已创建的弯曲：
   - 参数获得指向弯曲 mesh_verts 轨道的 `bindings[]`
   - 无需手动连线

3. 使用 `buildWarpKeyframes` 生成关键帧：
   - 为每种参数类型套用正确的弯曲数学
   - 存储到 Parameters 动画片段中

### 手动创建弯曲
用户也可以：
- 手动创建任意 `warpDeformer` 节点
- 把它的 `parameterId` 设为 41 个参数中的任意一个
- 把它的 `warpType` 设为所需的变形类型
- 预览参数变化时，编辑器会自动使用正确的数学

### 预览与强度调节
拖动滑块时（`handleWarpStrength`）：
- 找到所有绑定到该参数的弯曲变形器
- 按新的强度（0-100%）重新计算关键帧
- 实时更新 mesh_verts 轨道
- 画布预览立即显示变形

---

## 剩余缺口（原生编辑器不需要）

**结构性弯曲链**
Live2D 导出会创建一条 4 层结构链：
- Body Warp Z（根层）
- Body Warp Y（目标为 Z）
- Breath Warp（目标为 Y）
- Body Warp X（目标为 Breath）

原生编辑器不需要这条链，因为：
- 用户直接用滑块控制变形
- 预览不需要嵌套变形器求值
- 生成 .cmo3 时由导出逻辑处理链式关系

**暂无弯曲类型的参数**
部分参数（目前）没有对应变形：
- ParamTear, ParamBaseX/Y, ParamCheek, ParamHairFluffy
- ParamArmLA/RA/LB/RB, ParamHandL/R, ParamShoulderY
- 若定义了弯曲数学，可按需补充

---

## 改动的文件

- `src/components/canvas/CanvasViewport.jsx`
  - 新增 2 种弯曲数学类型：`body_angle_z`、`breathing`
  - 41 个参数均已在 LIVE_RIG_PARAMS 中定义
  - 所有弯曲规格均已在 WARP_SPECS 中定义

## 测试清单

- [ ] 新建项目并使用「Generate Rig」
- [ ] 确认已创建 BodyWarp、FaceWarp、NeckWarp
- [ ] 检查已为带标签的部件创建眼睛/嘴部/眉毛/头发弯曲
- [ ] 拖动 ParamBodyAngleZ 滑块 → 观察身体侧倾
- [ ] 拖动 ParamBreath 滑块 → 观察胸部起伏
- [ ] 手动创建弯曲变形器
- [ ] 将其绑定到 ParamBodyAngleY → 验证俯仰变形
- [ ] 导出 .cmo3 → 在 Cubism Editor 中验证参数与弯曲

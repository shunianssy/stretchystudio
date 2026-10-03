# 弯曲变形器与参数导出审计

## 摘要
原生弯曲变形器实现（CanvasViewport.jsx）支持 **41 个参数** 与 **13 个弯曲变形器**，但 Live2D 导出（cmo3writer.js）仅导出 **20 个参数**，且对弯曲变形器的支持有限。参数覆盖率缺口为 **51%**。

---

## 参数对比

### ✅ 已导出到 Live2D（41 个中的 20 个）
**位于 cmo3writer.js 的 `standardParams`：**

| 分组 | 已导出参数 |
|-------|-------------------|
| **面部旋转** (3/3) | ParamAngleX, ParamAngleY, ParamAngleZ |
| **眼睛** (2/11) | ParamEyeLOpen, ParamEyeROpen |
| **眼球** (2/4) | ParamEyeBallX, ParamEyeBallY |
| **眉毛** (2/8) | ParamBrowLY, ParamBrowRY |
| **嘴部** (2/2) | ParamMouthForm, ParamMouthOpenY |
| **身体旋转** (3/3) | ParamBodyAngleX, ParamBodyAngleY, ParamBodyAngleZ |
| **呼吸** (1/1) | ParamBreath |
| **头发** (3/3) | ParamHairFront, ParamHairSide, ParamHairBack |
| **物理衣物** (4/4) | ParamSkirt, ParamShirt, ParamPants, ParamBust |
| **合计** | **20/41** ✅ (49%) |

### ❌ 未导出（41 个中的 21 个）

| 分组 | 缺失参数 | 数量 |
|-------|-------------------|-------|
| **眼睛** | ParamEyeLSmile, ParamEyeRSmile, ParamEyeBallForm, ParamTear | 4 |
| **眉毛** | ParamBrowLX, ParamBrowRX, ParamBrowLAngle, ParamBrowRAngle, ParamBrowLForm, ParamBrowRForm | 6 |
| **手臂** | ParamArmLA, ParamArmRA, ParamArmLB, ParamArmRB, ParamHandL, ParamHandR | 6 |
| **肩膀** | ParamShoulderY | 1 |
| **胸部** | ParamBustX, ParamBustY | 2 |
| **全局** | ParamCheek, ParamHairFluffy, ParamBaseX, ParamBaseY | 4 |
| **缺失合计** | | **21/41** ❌ (51%) |

---

## 弯曲变形器对比

### ✅ 已导出到 Live2D（13 个中的 6-7 个）
**已在 cmo3writer.js 中实现：**

| 弯曲变形器 | 参数 | 类型 | 状态 |
|--------------|-----------|------|--------|
| `FaceWarp` | ParamAngleX | face_angle_x | ✅ 完整 |
| `BodyWarp` | ParamBodyAngleX | body_angle_x | ✅ 完整 |
| `NeckWarp` | ParamAngleZ | neck_follow | ✅ 完整（bodyRig.js） |
| `EyeLWarp` | ParamEyeLOpen | eye_open | ✅ 部分（绑定网格弯曲） |
| `EyeRWarp` | ParamEyeROpen | eye_open | ✅ 部分（绑定网格弯曲） |
| `MouthWarp` | ParamMouthOpenY | mouth_open | ✅ 部分（绑定网格弯曲） |
| `EyebrowLWarp` | ParamBrowLY | brow_y | ✅ 部分（绑定网格弯曲） |
| `EyebrowRWarp` | ParamBrowRY | brow_y | ✅ 部分（绑定网格弯曲） |

### ❌ 未导出（13 个中的 6 个）
**在 CanvasViewport.jsx 的 WARP_SPECS 中已定义，但 cmo3writer 中缺失：**

| 弯曲变形器 | 参数 | 类型 | 状态 |
|--------------|-----------|------|--------|
| `HairFrontWarp` | ParamHairFront | hair_sway | ❌ 无网格弯曲，仅参数 |
| `HairBackWarp` | ParamHairBack | hair_sway | ❌ 无网格弯曲，仅参数 |
| `TopWearWarp` | ParamBodyAngleX | body_angle_x | ❌ 无独立弯曲 |
| `BottomWearWarp` | ParamBodyAngleX | body_angle_x | ❌ 无独立弯曲 |
| *(ParamEyeLSmile 弯曲)* | ParamEyeLSmile | eye_smile | ❌ 未定义 |
| *(ParamEyeRSmile 弯曲)* | ParamEyeRSmile | eye_smile | ❌ 未定义 |
| ……以及另外 6 种以上弯曲类型 | ... | ... | ❌ 缺失 |

---

## cmo3writer.js 中实际包含的内容

### 弯曲变形器发射代码路径
1. **Body X Warp**（ParamBodyAngleX）—— 5×5 网格，目标为呼吸参数
2. **Body Y Warp**（ParamBodyAngleY）—— 全身 Y 轴旋转变形器
3. **Body Z Warp**（ParamBodyAngleZ）—— 控制呼吸/胸部起伏
4. **Face Parallax**（ParamAngleX/Y/Z）—— 带 3D 透视的多参数面部弯曲
5. **NeckWarp**（ParamAngleZ）—— 从 bodyRig.js 导入
6. **Face Rotation**（旋转变形器，非弯曲）—— 从 bodyRig.js 导入
7. **各部件绑定弯曲** —— 由各自参数驱动的睁眼、张口、眉毛 Y 位移

### cmo3writer 与 CanvasViewport 中的弯曲数学类型

| 弯曲类型 | cmo3writer | CanvasViewport | 覆盖率 |
|-----------|-----------|---|---|
| `face_angle_x` | ✅ 完整 | ✅ 完整 | 100% |
| `body_angle_x` | ✅ 完整 | ✅ 完整 | 100% |
| `neck_follow` | ✅ 完整（bodyRig.js） | ✅ 完整 | 100% |
| `eye_open` | ✅ 部分（绑定弯曲） | ✅ 完整 | ~60% |
| `mouth_open` | ✅ 部分（绑定弯曲） | ✅ 完整 | ~60% |
| `brow_y` | ✅ 部分（绑定弯曲） | ✅ 完整 | ~60% |
| `hair_sway` | ❌ 缺失 | ✅ 完整 | 0% |
| `body_angle_y` | ✅ 完整 | ✅ 完整 | 100% |
| `body_angle_z` | ✅ 完整 | ✅ 完整 | 100% |
| `face_angle_y` | ❌ 缺失 | ✅ 完整 | 0% |
| `eye_smile` | ❌ 缺失 | ✅ 完整 | 0% |
| `eye_gaze` | ❌ 缺失 | ✅ 完整 | 0% |
| `bust_wobble` | ❌ 缺失 | ✅ 完整 | 0% |

---

## 现有文档（docs/warp_deform_implementation.md）存在的问题

1. **第 3.4 节「Standard Live2D Coverage」**（第 303–379 行）声称 13 个弯曲变形器已全部完成
   - 实际上只有约 8 个导出到了 Live2D
   - HairFront/Back 弯曲只导出了参数，**没有**导出网格弯曲变形
   - TopWear/BottomWear 弯曲在 cmo3 中未拆分（复用 ParamBodyAngleX）

2. **「Known Gaps」章节**（第 360 行）列出了 32 个缺失参数
   - 对原生实现而言这是**正确**的
   - 但导出侧存在未记录的缺口：
     - TopWear/BottomWear 弯曲没有独立的网格绑定
     - 头发弯曲的关键形态未烘焙进导出（参数存在，但没有网格弯曲）

3. **弯曲规格与导出不一致**
   - CanvasViewport 中的 WARP_SPECS 定义了 10 个弯曲变形器规格
   - cmo3writer 只把其中约 6-7 个作为真实变形器发射出去

---

## 根本原因

**cmo3writer.js 通过以下方式发射弯曲变形器：**
1. 针对特定标签（eye_*、mouth_*、brow_*）硬编码的绑定弯曲
2. 结构性弯曲（Body X/Y/Z、NeckWarp）
3. Face Parallax 多参数弯曲

**但它没有：**
- 遍历原生绑定定义中的 WARP_SPECS
- 生成独立的 TopWear/BottomWear 网格弯曲
- 发射 hair_sway 弯曲变形（参数存在，但变形缺失）
- 为任何参数自动创建缺失的弯曲

---

## 补齐缺口的后续步骤

1. **将 WARP_SPECS 或等价定义导入** cmo3writer.js
2. **为所有 WARP_SPECS 发射弯曲变形器**，而不只是硬编码的那些
3. **拆分 TopWear 与 BottomWear** 为独立弯曲变形器（不再共用 ParamBodyAngleX）
4. **为 HairFront/Back 添加 hair_sway 弯曲发射**
5. **记录仍缺失的 21 个参数**，必要时为它们定义弯曲规格
6. **对照类 Hiyori 标准绑定测试**，确保功能对齐

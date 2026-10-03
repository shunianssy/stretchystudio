# TBLR（Top-Bottom-Left-Right）拆分实现

本文档对 See-through 框架如何将图层语义化拆分为左/右以及基于深度的组件（TBLR）进行技术剖析。

## 概述

“TBLR 拆分”是一个启发式后处理阶段，用于进一步将语义识别出的图层（如 “eyes” 或 “handwear”）分解为适合 Live2D 绑定的独立子图层。虽然主模型将 “handwear” 识别为单一的语义类别，但 TBLR 逻辑会基于空间连通性与坐标将左手与右手分离。

## 关键实现文件

- **[common/utils/inference_utils.py](file:///home/fiery/seethrough-repo/common/utils/inference_utils.py)**：包含核心的数学与图像处理逻辑。
- **[inference/scripts/heuristic_partseg.py](file:///home/fiery/seethrough-repo/inference/scripts/heuristic_partseg.py)**：提供一个 CLI 接口，用于在已有的 PSD 文件上执行这些拆分。

---

## 核心逻辑：左右拆分（`seg_wlr`）

左右拆分主要用于对称的身体部位。

### 1. 连通分量分析
系统使用 `cv2.connectedComponentsWithStats` 分析图层的 alpha 蒙版。它识别出所有空间上孤立的像素“岛屿”。

```python
num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
    mask.astype(np.uint8) * 255, connectivity=8)
```

### 2. 聚类选择与排序
如果检测到多个聚类，系统会：
1.  过滤掉背景（聚类 0）。
2.  按面积（`stats[..., -1]`）对其余聚类排序，以识别两个最主要的部分（例如两只手套）。
3.  将排名前两位的聚类传给 `label_lr_split`。

### 3. 空间指定（`label_lr_split`）
比较两个聚类的质心。**X 坐标较小**的聚类被指定为角色的右侧部位（从观看者视角看位于图像左侧），反之亦然。

```python
def label_lr_split(labels, stats, id1, id2):
    x1 = stats[id1][0] + stats[id1][2] / 2
    x2 = stats[id2][0] + stats[id2][2] / 2
    if x2 < x1:
        return label2, label1, stats2, stats1
    else:
        return label1, label2, stats1, stats2
```

### 4. 提取与命名
拆分出的部件被裁剪到各自的包围盒，并以如下后缀保存：
- `-l`：左侧（观看者的右侧）
- `-r`：右侧（观看者的左侧）

---

## 特殊处理

### 眼睛与面部特征
对于面部组件，逻辑更为细致。在 `v3` 管线中，以下标签会自动经过 LR 拆分逻辑：
- `eyewhite`
- `irides`
- `eyelash`
- `eyebrow`
- `ears`

对于合并的 `eyes` 图层还有一个回退方案（[inference_utils.py 第 452 行](file:///home/fiery/seethrough-repo/common/utils/inference_utils.py#L452)），它通过假设四个最大的连通分量就是两只眼睛和两条眉毛，来尝试提取四个部件（`eyer`、`eyel`、`browr`、`browl`）。

### 头发深度拆分（`cluster_inpaint_part`）
虽然严格来说不算“左右”拆分，但头发常使用基于深度的聚类拆分为 **前发** 与 **后发**。
系统对头发蒙版内的深度图数值使用 K-Means 聚类，依据中位深度值将 “Front Hair” 与 “Back Hair” 分离。

---

## 用法

### 集成到主管线
拆分由 `inference_psd.py` 中的 `--tblr_split` 标志触发：
```bash
python inference/scripts/inference_psd.py --srcp assets/test_image.png --tblr_split
```

### 在 PSD 上手动触发
你可以选择性地拆分已有 PSD 中的图层：
```bash
# Split handwear into left and right
python inference/scripts/heuristic_partseg.py seg_wlr --srcp workspace/output/sample.psd --target_tags handwear

# Split hair based on depth
python inference/scripts/heuristic_partseg.py seg_wdepth --srcp workspace/output/sample.psd --target_tags hair
```

---

## 局限性
- **遮挡**：如果两个对称部件发生重叠（例如一只手叠在另一只手上），它们可能被检测为单个连通分量，导致 LR 拆分失败或只得到一个图层。
- **复杂度**：带有多个漂浮部件的高度复杂饰品可能产生过多的连通分量，导致启发式算法只挑出最大的两个。

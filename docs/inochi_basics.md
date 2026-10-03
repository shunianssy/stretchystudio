导出为 **Inochi2D（`.inp`）** 格式，对于像你这样开源、“本地优先”的动画工具来说是一个绝佳选择。由于你已经在使用 **Three.js** 和 **React/Vite**，你会发现 Inochi2D 相对容易上手，因为它的核心数据结构基于 JSON，并被封装在一个简单的二进制容器中。

-----

## 1\. `.inp` 文件结构

`.inp` 文件（Inochi Puppet）是一个二进制容器，将模型元数据、节点层级和贴图图集打包进单个文件。头部中的所有多字节数字均以 **大端序（Big Endian）** 编码。

### 二进制布局

| Offset | Length | Content | Description |
| :--- | :--- | :--- | :--- |
| `0x00` | 8 bytes | `TRNSRTS\0` | **Magic Bytes**（代表 “Trans Rights!”）。 |
| `0x08` | 4 bytes | `uint32` | **JSON Payload Length**。 |
| `0x0C` | Variable | `JSON` | 模型的骨架与网格数据（UTF-8）。 |
| `EOF` | Variable | `Blobs` | 贴图数据区段。 |

### 贴图 Blob

在 JSON 载荷之后，文件包含一个或多个贴图区段：

1.  **Texture Payload Length**（4 字节，`uint32`）。
2.  **Texture Encoding**（1 字节）：通常为 `0`（PNG）或 `1`（TGA）。
3.  **Texture Data**：图像的原始字节。

-----

## 2\. JSON 数据规范

JSON 部分定义了 “Puppet”。它由两个主要键构成：`meta` 和 `nodes`。

### 元数据（`meta`）

包含 `name`、`version`、`authors`、`copyright` 和 `contact` 等字段。

### 节点层级（`nodes`）

这是一个递归的节点树。对于你的 “Stretchy Studio” 工具而言，最重要的节点类型是 **`Part`**。

  * **Node Properties：** `name`、`type`、`uuid`、`enabled`、`zSort`、`transform`。
  * **Mesh Data（位于 `Part` 内）：**
      * `vertices`：`float32` [x, y] 坐标的扁平数组。
      * `uvs`：`float32` [u, v] 坐标的扁平数组。
      * `indices`：用于定义三角形的 `uint16` 扁平数组。

-----

## 3\. 实现资源

由于你使用 **Three.js**，可以参考现有的（尽管仍是实验性的）TypeScript 实现，了解它们如何处理二进制解析与网格重建。

### 关键仓库

  * **[Inochi2D TypeScript（inochi2d-ts）](https://github.com/Inochi2D/inochi2d-ts)：** 这与你的技术栈最为相关。它使用 `binary-parser` 处理头部，使用 `three` 进行渲染。
  * **[Inochi2D 官方规范](https://www.google.com/search?q=https://docs.inochi2d.com/en/latest/inochi2d/index.html)：** 面向实现者的权威指南。
  * **[Inochi2D-rs（Rust）](https://www.google.com/search?q=https://github.com/linkmauve/inochi2d-rs)：** 一个高性能实现，如果你决定将导出逻辑迁移到后端或 WASM 模块，可能会很有用。

### 开发者提示

  * **坐标系：** Inochi2D 通常使用的坐标系中，(0,0) 是 puppet 的中心，而非左上角。
  * **版本管理：** 该格式演进迅速（目前为 v0.7–v0.8）。确保你的导出器在 `meta` 块中写入的 `version` 字符串与当前稳定版一致，以保证与 **Inochi Creator** 或 **Inochi Session** 的兼容性。
  * **压缩：** 虽然该格式支持 PNG，但保持贴图优化对于实时 VTubing 性能至关重要。

/**
 * canvas 命名空间文案（简体中文）
 * 覆盖：画布视口、PSD 导入向导、骨架叠加层、Gizmo 叠加层、弯曲晶格叠加层。
 * 由 group E 负责维护。
 */
export default {
  // ── 空画布 / 上传提示（CanvasViewport） ──────────────────────────────
  empty: {
    dropPrefix: '拖放或 ',
    click: '点击',
    dropMiddle: ' 上传 ',
    stretchTag: '.stretch',
    dropOr: ' 或 ',
    psdPngTag: 'PSD/PNG',
    subtitle: '导入 PSD，自动绑定骨骼，然后在时间轴上制作动画。',
    noPsdTitle: '还没有分层的 PSD？',
    layerify: '将你的图片图层化',
    freeSpace: '（免费的 HuggingFace Space）',
    providedByPrefix: '由 ',
    providedBySuffix: ' 的作者提供，这是一个可将单张角色插画自动拆解为可动画图层的 AI 模型。',
  },

  // ── 清空项目确认对话框（CanvasViewport） ─────────────────────────────
  wipe: {
    title: '清空当前项目？',
    description: '导入新项目或 PSD 将永久删除当前项目中的所有图层、网格和动画。此操作无法撤销。',
    confirm: '清空并加载',
  },

  // ── 关节调整工具条（SkeletonOverlay） ────────────────────────────────
  joints: {
    title: '调整关节',
    hint: '拖动黄色圆点以重新定位关节。',
  },

  // ── 骨架叠加层（SkeletonOverlay） ────────────────────────────────────
  skeleton: {
    limbMesh: {
      title: '需要肢体网格',
      description: '如需启用旋转：(1) 隐藏骨架，(2) 选中该肢体图层，(3) 点击“重新生成网格”。',
    },
    jointPivot: {
      title: '关节轴心位置异常',
      description: '肘/膝关节与肩/髋关节几乎重合，该部件的旋转形变已跳过。请在骨架编辑模式把关节拖到正确位置；若之后部件仍有扭曲，请在检查器中重新生成该部件网格。',
    },
    jointAutoFixed: {
      title: '已自动修正关节位置',
      description: '检测到肘/膝关节几乎与父关节重合，已按部件轮廓自动放回，并把关联网格恢复到未形变状态。可继续旋转；如位置不合适，可在骨架编辑模式微调。',
    },
    irisOffset: '虹膜偏移',
  },

  // ── 弯曲晶格叠加层（WarpLatticeOverlay） ─────────────────────────────
  warpLattice: {
    setParameterHint: '在检查器中设置参数以记录关键形态',
  },

  // ── PSD 导入向导（PsdImportWizard） ──────────────────────────────────
  wizard: {
    // 状态提示
    status: {
      loadingOnnx: '正在加载 ONNX 模型…',
      buildingRig: '正在构建绑定…',
    },
    // 步骤 1：检查图层映射
    review: {
      title: '检查图层映射',
      matched: '已匹配 {matched} / {total} 个图层',
      unmatchedCount: '{count} 个未匹配',
      tooFewInline: '数量过少，无法自动绑定',
      unassigned: '— 未分配 —',
      tooFewWarning: '自动绑定至少需要匹配 4 个图层。请在上方为未匹配的图层分配标签，或跳过绑定。',
      splitMerged: '拆分合并的部件（推荐）',
      meshAllParts: '导入后为所有部件生成网格',
      cancelImport: '取消导入',
      skipRigging: '跳过绑定',
      continue: '继续 →',
    },
    // 拆分合并部件提示
    split: {
      error: '无法分离：{names}。该图层可能是单一连通形状，将跳过对其的拆分。',
      partialTitle: '部分拆分信息',
    },
    // 眼部图层自动重排
    autoRearrange: {
      title: '图层已自动重排',
      description: '为获得正确的深度关系，虹膜已移动到眼白图层之上。',
    },
    // 步骤 2：重排图层
    reorder: {
      title: '第 2 步：重排图层',
      description: '在图层面板中按需调整图层顺序，以修复任何排序问题。',
      next: '下一步：调整关节 →',
    },
    // DWPose 模型加载
    dwpose: {
      title: '加载 DWPose 模型',
      description: '下载或上传约 50 MB 的 DWPose ONNX 模型，以实现高精度姿态检测。',
      statusLabel: '状态：',
      loaded: '已加载 ✓',
      notLoaded: '未加载',
      loadModel: '加载模型',
      loadOnnx: '加载 .onnx 文件',
      working: '处理中…',
      download: '下载',
    },
    // 步骤 3：调整关节
    adjust: {
      title: '第 3 步：调整关节',
      description: '拖动黄色圆点以重新定位关节。',
      meshAllParts: '为所有部件生成网格',
      autoRig: 'AI 自动绑定（DWPose）',
      next: '下一步：设置参数 →',
    },
    // 步骤 4：Live2D 参数
    liverig: {
      title: '第 4 步：Live2D 参数',
      previewPlaying: '正在播放待机预览',
      generating: '生成中…',
      skip: '跳过',
      done: '完成 →',
      group: {
        face: '面部',
        eye: '眼睛',
        eyeball: '眼球',
        brow: '眉毛',
        mouth: '嘴部',
        body: '身体',
        hair: '头发',
        other: '其他',
      },
    },
  },
};

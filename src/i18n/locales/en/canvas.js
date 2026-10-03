/**
 * canvas 命名空间文案（英文）
 * 覆盖：画布视口、PSD 导入向导、骨架叠加层、Gizmo 叠加层、弯曲晶格叠加层。
 * 由 group E 负责维护。
 */
export default {
  // ── 空画布 / 上传提示（CanvasViewport） ──────────────────────────────
  empty: {
    dropPrefix: 'Drop or ',
    click: 'click',
    dropMiddle: ' to upload a ',
    stretchTag: '.stretch',
    dropOr: ' or ',
    psdPngTag: 'PSD/PNG',
    subtitle: 'Character rigging and animation in seconds.',
    noPsdTitle: "Don't have a layered PSD?",
    layerify: 'LAYER-IFY YOUR IMAGE',
    freeSpace: '(Free HuggingFace Space)',
    providedByPrefix: 'Provided by the authors of ',
    providedBySuffix: ', an AI model that automatically decomposes single character illustrations into ready-to-animate layers.',
  },

  // ── 清空项目确认对话框（CanvasViewport） ─────────────────────────────
  wipe: {
    title: 'Wipe current project?',
    description: 'Importing a new project or PSD will permanently delete all existing layers, meshes, and animations in your current project. This action cannot be undone.',
    confirm: 'Wipe & Load',
  },

  // ── 关节调整工具条（SkeletonOverlay） ────────────────────────────────
  joints: {
    title: 'Adjust Joints',
    hint: 'Drag yellow dots to reposition joints.',
  },

  // ── 骨架叠加层（SkeletonOverlay） ────────────────────────────────────
  skeleton: {
    limbMesh: {
      title: 'Limb mesh required',
      description: "To enable rotation: (1) Hide armature, (2) Select the limb layer, (3) Click 'Remesh'.",
    },
    irisOffset: 'Iris Offset',
  },

  // ── 弯曲晶格叠加层（WarpLatticeOverlay） ─────────────────────────────
  warpLattice: {
    setParameterHint: 'Set a parameter in the Inspector to record keyforms',
  },

  // ── PSD 导入向导（PsdImportWizard） ──────────────────────────────────
  wizard: {
    // 状态提示
    status: {
      loadingOnnx: 'Loading ONNX model…',
      buildingRig: 'Building rig…',
    },
    // 步骤 1：检查图层映射
    review: {
      title: 'Review Layer Mapping',
      matched: '{matched} of {total} layers matched',
      unmatchedCount: '{count} unmatched',
      tooFewInline: 'too few for auto-rig',
      unassigned: '— unassigned —',
      tooFewWarning: 'At least 4 layers must be matched for automatic rigging. Assign unmatched layers above or skip rigging.',
      splitMerged: 'Split merged parts (recommended)',
      meshAllParts: 'Mesh all parts after import',
      cancelImport: 'Cancel Import',
      skipRigging: 'Skip rigging',
      continue: 'Continue →',
    },
    // 拆分合并部件提示
    split: {
      error: 'Could not separate: {names}. The layer may be a single connected shape. Continuing without splitting them.',
      partialTitle: 'Partial Split Info',
    },
    // 眼部图层自动重排
    autoRearrange: {
      title: 'Layers Auto-Rearranged',
      description: 'Eye irides moved above eyewhite layers for proper depth.',
    },
    // 步骤 2：重排图层
    reorder: {
      title: 'Step 2: Reorder Layers',
      description: 'Rearrange layers in the Layer Panel as needed to fix any ordering issues.',
      next: 'Next: Adjust Joints →',
    },
    // DWPose 模型加载
    dwpose: {
      title: 'Load DWPose model',
      description: 'Download or upload the ~50 MB DWPose ONNX model for high-accuracy pose detection.',
      statusLabel: 'Status:',
      loaded: 'Loaded ✓',
      notLoaded: 'Not loaded',
      loadModel: 'Load Model',
      loadOnnx: 'Load .onnx file',
      working: 'Working…',
      download: 'Download',
    },
    // 步骤 3：调整关节
    adjust: {
      title: 'Step 3: Adjust Joints',
      description: 'Drag yellow dots to reposition joints.',
      meshAllParts: 'Mesh all parts',
      autoRig: 'AI Auto-Rig (DWPose)',
      next: 'Next: Setup Parameters →',
    },
    // 步骤 4：Live2D 参数
    liverig: {
      title: 'Step 4: Live2D Parameters',
      previewPlaying: 'Idle preview playing',
      generating: 'Generating…',
      skip: 'Skip',
      done: 'Done →',
      group: {
        face: 'Face',
        eye: 'Eye',
        eyeball: 'Eyeball',
        brow: 'Brow',
        mouth: 'Mouth',
        body: 'Body',
        hair: 'Hair',
        other: 'Other',
      },
    },
  },
};

/**
 * io 命名空间文案（英文）
 * 覆盖：导出弹窗、保存弹窗、加载弹窗、项目画廊、偏好设置、物理面板。
 * 由 group D 负责维护。
 *
 * 子模块划分：
 * - export：导出弹窗（ExportModal）
 * - save：保存弹窗（SaveModal）
 * - load：加载弹窗（LoadModal）
 * - gallery：项目画廊（ProjectGallery）
 * - preferences：偏好设置弹窗（PreferencesModal）
 * - physics：物理面板（PhysicsPanel）
 */
export default {
  // 导出弹窗（ExportModal）
  export: {
    title: 'Export',
    action: 'Export',
    exporting: 'Exporting...',
    labelType: 'Type',
    labelFormat: 'Format',
    labelModelName: 'Model Name',
    labelAtlasSize: 'Atlas Size',
    labelAnimation: 'Animation',
    labelFps: 'FPS',
    labelFrame: 'Frame',
    labelImageContains: 'Image Contains',
    labelOutputScale: 'Output Scale (%)',
    labelBackground: 'Background',
    labelExportTo: 'Export to',
    placeholderModelName: 'model',
    // 导出类型（Select 选项）
    typeSequence: 'Sequence',
    typeSingleFrame: 'Single Frame',
    typeLive2DProject: 'Live2D Project',
    typeLive2DRuntime: 'Live2D Runtime ⚠️',
    typeSpine: 'Spine (4.0+)',
    // 动画目标选项
    animStaging: 'Staging',
    animCurrent: 'Current',
    animAll: 'All',
    // 画面范围选项
    imageCanvasArea: 'Canvas area',
    imageMinArea: 'Min image area',
    imageCustom: 'Custom',
    // 背景选项
    bgTransparent: 'Transparent',
    bgCustomColor: 'Custom color',
    // 导出目标选项
    destZip: 'ZIP file',
    destFolder: 'Folder',
    destNotSupported: '(not supported)',
    // Live2D 提示与选项
    testingOnly: '⚠️ Testing Only',
    runtimeWarningPrefix: 'The Runtime option is for debugging. It cannot be loaded into Cubism Editor and does not support animations. Use',
    runtimeWarningSuffix: 'for production.',
    generateRigLabel: 'Generate standard Live2D rig',
    generateRigDesc: 'Adds warp deformers, standard parameters (ParamAngleX/Y/Z, ParamBody, etc.), and face-part deformer hierarchy',
    generatePhysicsLabel: 'Generate physics (hair + clothing swing, bust wobble)',
    generatePhysicsDesc: "Adds pendulum simulations. Rules auto-skip when the matching tag isn't present, so bare-armed / skirtless characters drop unused rules on their own.",
    physicsHairLabel: 'Hair (front / back).',
    physicsHairHint: 'Turn off for buzz-cut / short-hair characters.',
    physicsClothingLabel: 'Clothing (shirt hem + sleeves, skirt, pants).',
    physicsBustLabel: 'Bust wobble.',
    physicsBustHint: 'Turn off for male / flat-chest characters.',
    physicsArmsLabel: 'Arm sway (forearm lags body roll/tilt).',
    customRulesLabel: 'Custom physics rules',
    customRulesCount: '({count} rules)',
    configureRules: 'Configure physics rules…',
    cmo3Description: 'project file editable in Cubism Editor 5.0. Each mesh gets its own texture.',
    runtimeFormatDescription: 'runtime format (SDK 4.0). Experimental: no animation support and not editable in Cubism Editor.',
    // Spine 导入说明
    spineHowTo: 'How to import to Spine:',
    spineStep1Prefix: 'Unzip the exported',
    spineStep1Suffix: 'file',
    spineStep2Prefix: 'In Spine, go to',
    spineStep3Prefix: 'Select the',
    spineStep3Suffix: 'file from the unzipped folder',
    // 校验与状态
    jpgWarning: "JPG doesn't support transparency — pixels will be black.",
    exportFailedLabel: 'Export failed:',
    exportFailed: 'Export failed',
    noTargetSelected: 'No target selected to export',
    // 进度文案
    progressLoadingTextures: 'Loading textures...',
    progressPreparing: 'Preparing...',
    progressWritingOutput: 'Writing output...',
    frameProgress: '{name} — frame {frame}',
  },

  // 保存弹窗（SaveModal）
  save: {
    title: 'Save Project',
    projectName: 'Project Name',
    projectNamePlaceholder: 'Enter project name...',
    saveToLibrary: 'Save to Library',
    downloadFile: 'Download File',
    untitledProject: 'Untitled Project',
    overwriteTitle: 'Overwrite project?',
    overwriteDescPrefix: 'Are you sure you want to overwrite',
    overwriteDescSuffix: '? This will replace the project data and thumbnail in your library.',
    overwrite: 'Overwrite',
  },

  // 加载弹窗（LoadModal）
  load: {
    title: 'Load Project',
    projectLibrary: 'Project Library',
    importProject: 'Import Project',
    selectStretchFile: 'Select .stretch file',
  },

  // 项目画廊（ProjectGallery）
  gallery: {
    emptyTitle: 'No saved projects yet',
    emptyHint: 'Projects saved to library will appear here.',
    download: 'Download .stretch',
    deleteTitle: 'Delete project?',
    deleteDesc: 'Are you sure you want to delete this project from the library? This action cannot be undone.',
    deleteConfirm: 'Delete Project',
  },

  // 偏好设置弹窗（PreferencesModal）
  preferences: {
    title: 'Preferences',
    tabGeneral: 'General',
    tabInterface: 'Interface',
    tabAbout: 'About',
    selectDarkTheme: 'Select Dark Theme',
    selectLightTheme: 'Select Light Theme',
    generalSettings: 'General Settings',
    nothingHere: 'Nothing here yet',
    appearance: 'Appearance',
    appearanceDesc: 'Customize how Stretchy Studio looks on your screen.',
    themeMode: 'Theme Mode',
    light: 'Light',
    lightMode: 'Light mode',
    dark: 'Dark',
    darkMode: 'Dark mode',
    system: 'System',
    systemMode: 'System mode',
    colorPreset: 'Color Preset',
    fontFamily: 'Font Family',
    selectFont: 'Select a font',
    fontSize: 'Font Size ({size}px)',
    version: 'Version {version}',
    aboutDesc: 'A modern 2D animation and rigging tool focused on ease of use and rapid prototyping.',
    ecosystem: 'Ecosystem',
    ecosystemDescPrefix: 'Stretchy Studio is designed as an animation engine for the',
    ecosystemDescSuffix: 'model.',
    seeThroughRepo: 'See-through Repo',
    freeSpace: 'Free HuggingFace Space',
    projectDetails: 'Project Details',
    framework: 'Framework:',
    styling: 'Styling:',
    components: 'Components:',
    icons: 'Icons:',
    acknowledgements: 'Acknowledgements',
    thankyouPrefix: 'Special thanks to',
    thankyouSuffix: 'for their incredible work developing the entire Live2D export engine, including the procedural rigging, parallax, and eye-closure systems.',
  },

  // 物理面板（PhysicsPanel）
  physics: {
    categoryHair: 'Hair',
    categoryClothing: 'Clothing',
    categoryBust: 'Bust',
    categoryArms: 'Arms',
    loadDefaults: 'Load Defaults',
    loadDefaultsHint: 'Populate from built-in PHYSICS_RULES defaults',
    clearAll: 'Clear all',
    clearAllHint: 'Clear all rules (export will use built-in defaults)',
    empty: 'No custom rules — export uses built-in defaults ({count} rules). Press "Load Defaults" to customise.',
    deleteRule: 'Delete rule',
    name: 'Name',
    category: 'Category',
    requireTag: 'Require tag (skip if no mesh has this tag; leave blank to always emit)',
    requireTagPlaceholder: 'e.g. front hair',
    pendulumVertices: 'Pendulum vertices (root → tip)',
    vertexY: 'Y (len)',
    mobility: 'Mobility',
    delay: 'Delay',
    accel: 'Accel',
    outputParamId: 'Output param ID',
    outputScale: 'Output scale',
  },
  // 导出过程中的进度提示（由 io 层回调给导出弹窗显示）
  progress: {
    packingTextureAtlas: 'Packing texture atlas...',
    generatingMoc3: 'Generating .moc3 binary...',
    generatingMotions: 'Generating motion files...',
    generatingDisplayInfo: 'Generating display info...',
    generatingModelManifest: 'Generating model manifest...',
    creatingZip: 'Creating ZIP...',
    preparingMeshes: 'Preparing {count} meshes...',
    encodingTexture: 'Encoding texture {current}/{total}...',
    generatingCmo3: 'Generating .cmo3 ({count} meshes)...',
    generatingCan3: 'Generating .can3 animation...',
    preparingSkeletonData: 'Preparing skeleton data...',
    collectingTextures: 'Collecting textures...',
    packingImage: 'Packing image: {filename}',
    generatingZip: 'Generating ZIP...',
    packingFile: 'Packing {animName}/{filename}',
    writingFile: 'Writing {animName}/{filename}',
    compositingCharacter: 'Compositing character…',
    runningDwpose: 'Running DWPose inference…',
  },
  // 导出过程中的错误提示
  errors: {
    noVisibleMeshes: 'No visible parts with meshes found. Generate meshes before exporting.',
    noMatchingTextures:
      'Found {parts} parts but no matching textures ({textures} textures loaded). Check that parts have textureId matching a texture.',
    dwposeOutputFormat: 'DWPose: unexpected output format (no simcc_x/simcc_y).',
    stringTooLong: 'String "{value}" too long for {size}-byte field',
  },
};

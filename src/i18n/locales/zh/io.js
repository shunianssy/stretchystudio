/**
 * io 命名空间文案（简体中文）
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
    title: '导出',
    action: '导出',
    exporting: '导出中…',
    labelType: '类型',
    labelFormat: '格式',
    labelModelName: '模型名称',
    labelAtlasSize: '图集尺寸',
    labelAnimation: '动画',
    labelFps: '帧率',
    labelFrame: '帧',
    labelImageContains: '画面包含',
    labelOutputScale: '输出缩放 (%)',
    labelBackground: '背景',
    labelExportTo: '导出到',
    placeholderModelName: 'model',
    // 导出类型（Select 选项）
    typeSequence: '序列',
    typeSingleFrame: '单帧',
    typeLive2DProject: 'Live2D 工程',
    typeLive2DRuntime: 'Live2D 运行时 ⚠️',
    typeSpine: 'Spine (4.0+)',
    // 动画目标选项
    animStaging: '暂存区',
    animCurrent: '当前',
    animAll: '全部',
    // 画面范围选项
    imageCanvasArea: '画布区域',
    imageMinArea: '最小图像区域',
    imageCustom: '自定义',
    // 背景选项
    bgTransparent: '透明',
    bgCustomColor: '自定义颜色',
    // 导出目标选项
    destZip: 'ZIP 文件',
    destFolder: '文件夹',
    destNotSupported: '（不支持）',
    // Live2D 提示与选项
    testingOnly: '⚠️ 仅供测试',
    runtimeWarningPrefix: '运行时选项仅用于调试，无法载入 Cubism Editor 且不支持动画。生产环境请使用',
    runtimeWarningSuffix: '。',
    generateRigLabel: '生成标准 Live2D 绑定',
    generateRigDesc: '添加变形器、标准参数（ParamAngleX/Y/Z、ParamBody 等）以及面部部件变形器层级',
    generatePhysicsLabel: '生成物理（头发 + 服装摆动、胸部晃动）',
    generatePhysicsDesc: '添加钟摆模拟。当缺少匹配标签时规则会自动跳过，因此无袖/无裙的角色会自动丢弃未使用的规则。',
    physicsHairLabel: '头发（前发 / 后发）。',
    physicsHairHint: '短发 / 寸头角色请关闭。',
    physicsClothingLabel: '服装（衬衫下摆 + 袖子、裙子、裤子）。',
    physicsBustLabel: '胸部晃动。',
    physicsBustHint: '男性 / 平胸角色请关闭。',
    physicsArmsLabel: '手臂摆动（前臂滞后于身体翻转/倾斜）。',
    customRulesLabel: '自定义物理规则',
    customRulesCount: '（{count} 条规则）',
    configureRules: '配置物理规则…',
    cmo3Description: '工程文件，可在 Cubism Editor 5.0 中编辑。每个网格拥有独立贴图。',
    runtimeFormatDescription: '运行时格式（SDK 4.0）。实验性功能：不支持动画，且无法在 Cubism Editor 中编辑。',
    // Spine 导入说明
    spineHowTo: '如何导入到 Spine：',
    spineStep1Prefix: '解压导出的',
    spineStep1Suffix: '文件',
    spineStep2Prefix: '在 Spine 中，进入',
    spineStep3Prefix: '从解压后的文件夹中选择',
    spineStep3Suffix: '文件',
    // 校验与状态
    jpgWarning: 'JPG 不支持透明度 —— 像素将变为黑色。',
    exportFailedLabel: '导出失败：',
    exportFailed: '导出失败',
    noTargetSelected: '未选择要导出的目标',
    // 进度文案
    progressLoadingTextures: '正在加载贴图…',
    progressPreparing: '正在准备…',
    progressWritingOutput: '正在写入输出…',
    frameProgress: '{name} — 第 {frame} 帧',
  },

  // 保存弹窗（SaveModal）
  save: {
    title: '保存项目',
    projectName: '项目名称',
    projectNamePlaceholder: '输入项目名称…',
    saveToLibrary: '保存到资源库',
    downloadFile: '下载文件',
    untitledProject: '未命名项目',
    overwriteTitle: '覆盖项目？',
    overwriteDescPrefix: '确定要覆盖',
    overwriteDescSuffix: '吗？这将替换资源库中的项目数据与缩略图。',
    overwrite: '覆盖',
  },

  // 加载弹窗（LoadModal）
  load: {
    title: '载入项目',
    projectLibrary: '项目资源库',
    importProject: '导入项目',
    selectStretchFile: '选择 .stretch 文件',
  },

  // 项目画廊（ProjectGallery）
  gallery: {
    emptyTitle: '暂无已保存的项目',
    emptyHint: '保存到资源库的项目将显示在这里。',
    download: '下载 .stretch',
    deleteTitle: '删除项目？',
    deleteDesc: '确定要从资源库中删除此项目吗？此操作无法撤销。',
    deleteConfirm: '删除项目',
  },

  // 偏好设置弹窗（PreferencesModal）
  preferences: {
    title: '偏好设置',
    tabGeneral: '常规',
    tabInterface: '界面',
    tabAbout: '关于',
    selectDarkTheme: '选择深色主题',
    selectLightTheme: '选择浅色主题',
    generalSettings: '常规设置',
    nothingHere: '暂无内容',
    appearance: '外观',
    appearanceDesc: '自定义 Stretchy Studio 在屏幕上的显示效果。',
    themeMode: '主题模式',
    light: '浅色',
    lightMode: '浅色模式',
    dark: '深色',
    darkMode: '深色模式',
    system: '跟随系统',
    systemMode: '跟随系统模式',
    colorPreset: '配色预设',
    fontFamily: '字体',
    selectFont: '选择字体',
    fontSize: '字号（{size}px）',
    version: '版本 {version}',
    aboutDesc: '一款专注于易用性与快速原型设计的现代 2D 动画与绑定工具。',
    ecosystem: '生态',
    ecosystemDescPrefix: 'Stretchy Studio 是作为',
    ecosystemDescSuffix: '模型的动画引擎而设计的。',
    seeThroughRepo: 'See-through 仓库',
    freeSpace: '免费 HuggingFace Space',
    projectDetails: '项目详情',
    framework: '框架：',
    styling: '样式：',
    components: '组件：',
    icons: '图标：',
    acknowledgements: '致谢',
    thankyouPrefix: '特别感谢',
    thankyouSuffix: '开发了整套 Live2D 导出引擎，包括程序化绑定、视差与闭眼系统等出色工作。',
  },

  // 物理面板（PhysicsPanel）
  physics: {
    categoryHair: '头发',
    categoryClothing: '服装',
    categoryBust: '胸部',
    categoryArms: '手臂',
    loadDefaults: '加载默认值',
    loadDefaultsHint: '从内置 PHYSICS_RULES 默认值填充',
    clearAll: '全部清除',
    clearAllHint: '清除所有规则（导出时将使用内置默认值）',
    empty: '暂无自定义规则 —— 导出将使用内置默认规则（{count} 条）。点击“加载默认值”进行自定义。',
    deleteRule: '删除规则',
    name: '名称',
    category: '类别',
    requireTag: '要求的标签（若没有网格带有此标签则跳过；留空则始终生成）',
    requireTagPlaceholder: '例如 front hair',
    pendulumVertices: '钟摆顶点（根部 → 末端）',
    vertexY: 'Y（长度）',
    mobility: '可动性',
    delay: '延迟',
    accel: '加速度',
    outputParamId: '输出参数 ID',
    outputScale: '输出缩放',
  },
  // 导出过程中的进度提示（由 io 层回调给导出弹窗显示）
  progress: {
    packingTextureAtlas: '正在打包贴图集…',
    generatingMoc3: '正在生成 .moc3 二进制…',
    generatingMotions: '正在生成动作文件…',
    generatingDisplayInfo: '正在生成显示信息…',
    generatingModelManifest: '正在生成模型清单…',
    creatingZip: '正在创建 ZIP…',
    preparingMeshes: '正在准备 {count} 个网格…',
    encodingTexture: '正在编码贴图 {current}/{total}…',
    generatingCmo3: '正在生成 .cmo3（{count} 个网格）…',
    generatingCan3: '正在生成 .can3 动画…',
    preparingSkeletonData: '正在准备骨架数据…',
    collectingTextures: '正在收集贴图…',
    packingImage: '正在打包图像：{filename}',
    generatingZip: '正在生成 ZIP…',
    packingFile: '正在打包 {animName}/{filename}',
    writingFile: '正在写入 {animName}/{filename}',
    compositingCharacter: '正在合成角色…',
    runningDwpose: '正在运行 DWPose 推理…',
  },
  // 导出过程中的错误提示
  errors: {
    noVisibleMeshes: '未找到带网格的可见部件。请先生成网格后再导出。',
    noMatchingTextures:
      '找到 {parts} 个部件，但没有匹配的贴图（已加载 {textures} 张）。请检查部件的 textureId 是否与贴图匹配。',
    dwposeOutputFormat: 'DWPose：输出格式异常（缺少 simcc_x/simcc_y）。',
    stringTooLong: '字符串 "{value}" 超出 {size} 字节字段的上限',
  },
};

/**
 * editor 命名空间文案（简体中文）
 * 覆盖：顶部工具栏与整体布局、模式切换、画布属性、确认弹窗、移动端布局（PhoneLayout）。
 */
export default {
  topBar: {
    newProject: '新建项目',
    saveProject: '保存项目',
    loadProject: '载入项目',
    exportFrames: '导出帧',
    preferences: '偏好设置',
    language: '语言',
    undo: '撤销 (Ctrl+Z)',
    redo: '重做 (Ctrl+Y)',
    zoomHint: '滚轮缩放 · Alt+拖拽平移',
  },
  mode: {
    staging: '设定',
    stagingTip: '在设定模式下，你可以设置基础布局、网格结构与关节位置。',
    animation: '动画',
    animationTip: '在动画模式下，你可以在时间轴上创建关键帧。',
  },
  canvasProps: {
    title: '画布属性',
    xOffset: 'X 偏移',
    yOffset: 'Y 偏移',
    backgroundColor: '背景颜色',
    fitToMinArea: '适配最小动画区域',
  },
  panels: {
    layers: '图层',
    inspector: '属性检查器',
  },
  confirm: {
    replaceTitle: '替换当前项目？',
    replaceDesc: '这会永久删除当前工作区中已有的所有图层、网格与动画，未保存的更改将会丢失。',
    replaceWorkspace: '替换工作区',
    storeTitle: '将导入的项目保存到资源库？',
    storeDesc: '是否要把此项目保存到资源库，以便日后快速访问？',
    skip: '跳过',
    saveToLibrary: '保存到资源库',
  },
  phone: {
    selectDarkTheme: '选择深色主题',
    selectLightTheme: '选择浅色主题',
    themeMode: '主题模式',
    lightMode: '浅色模式',
    darkMode: '深色模式',
    selectTheme: '选择主题',
  },
};

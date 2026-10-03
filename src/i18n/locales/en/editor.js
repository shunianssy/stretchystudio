/**
 * editor 命名空间文案（英文）
 * 覆盖：顶部工具栏与整体布局、模式切换、画布属性、确认弹窗、移动端布局（PhoneLayout）。
 */
export default {
  topBar: {
    newProject: 'New project',
    saveProject: 'Save project',
    loadProject: 'Load project',
    exportFrames: 'Export frames',
    preferences: 'Preferences',
    language: 'Language',
    undo: 'Undo (Ctrl+Z)',
    redo: 'Redo (Ctrl+Y)',
    zoomHint: 'Scroll to zoom · Alt+drag to pan',
  },
  mode: {
    staging: 'Staging',
    stagingTip: 'In Staging mode, you set the base layout, mesh structure, and joint positions.',
    animation: 'Animation',
    animationTip: 'In Animation mode, you create keyframes on the timeline.',
  },
  canvasProps: {
    title: 'Canvas Properties',
    xOffset: 'X Offset',
    yOffset: 'Y Offset',
    backgroundColor: 'Background Color',
    fitToMinArea: 'Fit to minimum animation area',
  },
  panels: {
    layers: 'Layers',
    inspector: 'Inspector',
  },
  confirm: {
    replaceTitle: 'Replace current project?',
    replaceDesc:
      'This will permanently delete all existing layers, meshes, and animations in your current workspace. Unsaved changes will be lost.',
    replaceWorkspace: 'Replace Workspace',
    storeTitle: 'Store imported project in Library?',
    storeDesc: 'Would you like to save this project to your library so you can access it easily later?',
    skip: 'Skip',
    saveToLibrary: 'Save to Library',
  },
  phone: {
    selectDarkTheme: 'Select Dark Theme',
    selectLightTheme: 'Select Light Theme',
    themeMode: 'Theme mode',
    lightMode: 'Light mode',
    darkMode: 'Dark mode',
    selectTheme: 'Select Theme',
  },
};

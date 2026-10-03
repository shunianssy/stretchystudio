/**
 * timeline 命名空间文案（简体中文）
 * 覆盖：时间轴面板（TimelinePanel）、动画列表面板（AnimationListPanel）。
 * 子模块划分：
 *  - audioModal     音频设置弹窗
 *  - audioTrack     音频轨道行
 *  - transport      播放控制栏
 *  - fields         帧 / 起始 / 结束 / 帧率 数值字段
 *  - contextMenu    关键帧右键菜单（Copy / Remove 复用 common.*）
 *  - keyframe       关键帧提示
 *  - empty          空状态提示
 *  - animationList  动画列表面板
 *  - defaultAnimationName 新建动画的默认名称
 */
export default {
  audioModal: {
    title: '音频设置',
    trackName: '轨道名称',
    trackNamePlaceholder: '例如：背景音乐',
    timelineStart: '时间轴起始',
    timelineStartHint: '音频在动画时间轴上开始播放的位置。',
    clipStart: '音频片段起始',
    clipStartHint: '从源音频文件开头处裁剪。',
    playDuration: '播放时长',
    playDurationHint: '该音频片段的总播放时间。',
    sourceDuration: '源时长',
    audioSegment: '音频片段范围',
    timelineSpan: '时间轴跨度',
    applyChanges: '应用更改',
  },
  audioTrack: {
    untitled: '未命名音频',
    defaultName: '音频 {index}',
    settings: '音频设置',
    delete: '删除音频轨道',
    upload: '上传音频',
    dragHint: '{name} — 拖动可移动，拖动边缘可裁剪',
    namePrompt: '音频轨道名称：',
    missingAnimation: '请先创建动画再添加音频',
    add: '添加音频轨道',
  },
  transport: {
    firstFrame: '首帧',
    play: '播放',
    pause: '暂停',
    lastFrame: '末帧',
    repeat: '循环',
    newAnimation: '+ 新建动画',
    loopKeyframes: '循环关键帧：启用后，动画将从最后一个关键帧插值回第一个关键帧，以实现无缝循环。',
    autoKeyframe: '自动关键帧：属性改变时自动将数值记录到轨道',
    speed: '速度',
    speedHint: '播放速度倍率。',
    keyHint: '按 K 为选中节点打关键帧',
  },
  fields: {
    frame: '帧',
    frameTip: '当前播放帧。',
    start: '起始',
    startTip: '动画循环的第一帧。',
    end: '结束',
    endTip: '动画循环的最后一帧。',
    fps: '帧率',
    fpsTip: '每秒帧数 — 决定播放粒度。',
  },
  contextMenu: {
    paste: '粘贴',
    linear: '线性',
    easeBoth: '缓入缓出',
    easeIn: '缓入',
    easeOut: '缓出',
    stepped: '阶跃',
  },
  keyframe: {
    hint: '第 {frame} 帧 — 点击选中，拖动移动',
    loopWrapHint: '循环回绕：引用第 {frame} 帧的首个关键帧',
  },
  empty: {
    withAnimation: '选择一个节点并按 K 添加关键帧，或点击 🎵 添加音频',
    noAnimation: '创建动画以开始',
  },
  animationList: {
    title: '动画',
    createNew: '新建动画',
    empty: '暂无动画。',
    deleteTitle: '删除动画',
    deleteDescription: '确定要删除此动画吗？这将移除所有关联的轨道和关键帧。',
    deleteConfirm: '删除动画',
  },
  defaultAnimationName: '动画 1',
};

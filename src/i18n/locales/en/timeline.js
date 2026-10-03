/**
 * timeline 命名空间文案（英文）
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
    title: 'Audio Settings',
    trackName: 'Track Name',
    trackNamePlaceholder: 'e.g. Background Music',
    timelineStart: 'Timeline Start',
    timelineStartHint: 'Where on the animation timeline the audio begins.',
    clipStart: 'Audio Clip Start',
    clipStartHint: 'Trim from the beginning of the source audio file.',
    playDuration: 'Play Duration',
    playDurationHint: 'Total time this audio clip will play for.',
    sourceDuration: 'Source Duration',
    audioSegment: 'Audio Segment',
    timelineSpan: 'Timeline Span',
    applyChanges: 'Apply Changes',
  },
  audioTrack: {
    untitled: 'Untitled Audio',
    defaultName: 'Audio {index}',
    settings: 'Audio settings',
    delete: 'Delete audio track',
    upload: 'Upload audio',
    dragHint: '{name} — drag to move, drag edges to trim',
    namePrompt: 'Audio track name:',
    missingAnimation: 'Create an animation first to add audio',
    add: 'Add audio track',
  },
  transport: {
    firstFrame: 'First Frame',
    play: 'Play',
    pause: 'Pause',
    lastFrame: 'Last Frame',
    repeat: 'Repeat',
    newAnimation: '+ New Animation',
    loopKeyframes: 'Loop Keyframes: When active, the animation will interpolate from the last keyframe back to the first keyframe for a seamless loop.',
    autoKeyframe: 'Auto Keyframe: Automatically commit values to track when properties are changed',
    speed: 'Speed',
    speedHint: 'Playback speed multiplier.',
    keyHint: 'Press K to keyframe selected nodes',
  },
  fields: {
    frame: 'Frame',
    frameTip: 'The current playback frame.',
    start: 'Start',
    startTip: 'The first frame of the animation loop.',
    end: 'End',
    endTip: 'The last frame of the animation loop.',
    fps: 'FPS',
    fpsTip: 'Frames per second — determines playback granularity.',
  },
  contextMenu: {
    paste: 'Paste',
    linear: 'Linear',
    easeBoth: 'Ease Both',
    easeIn: 'Ease In',
    easeOut: 'Ease Out',
    stepped: 'Stepped',
  },
  keyframe: {
    hint: 'Frame {frame} — click to select, drag to move',
    loopWrapHint: 'Loop wrap-around: references first keyframe at frame {frame}',
  },
  empty: {
    withAnimation: 'Select a node and press K to add keyframes or click 🎵 to add audio',
    noAnimation: 'Create an animation to begin',
  },
  animationList: {
    title: 'Animations',
    createNew: 'Create New Animation',
    empty: 'No animations.',
    deleteTitle: 'Delete Animation',
    deleteDescription: 'Are you sure you want to delete this animation? This will remove all associated tracks and keyframes.',
    deleteConfirm: 'Delete Animation',
  },
  defaultAnimationName: 'Animation 1',
};

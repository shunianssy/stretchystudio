/**
 * 数据名称本地化映射（仅用于“界面显示”，绝不修改真实数据）
 *
 * 背景：
 *   项目里的节点名、骨骼角色名、部件标签、变形器名、Live2D 参数名等，
 *   都是固定英文标识（英文名参与 PSD 格式识别、导出与绑定逻辑），
 *   不能直接改写数据，否则会破坏导入/导出流程。
 *   因此这里只提供一张“英文数据名 → 中文显示名”的映射表，
 *   在渲染层调用 labelFor() 做显示转换，数据本身保持英文。
 *
 * 用法（组件内，已有 lang）：
 *   const { t, lang } = useTranslation();
 *   <span>{labelFor(node.name, lang)}</span>
 *
 * 用法（非组件环境）：
 *   labelFor(name, useLanguageStore.getState().lang)
 */

/** 中文显示名映射表（键为数据中的原始英文名） */
const ZH_NAMES = {
  /* ── 角色自动组织分组（psdOrganizer） ───────────────────────────── */
  body: '身体',
  upperbody: '上半身',
  lowerbody: '下半身',
  head: '头部',
  eyes: '眼睛',
  extras: '附加',

  /* ── 骨骼角色（armatureOrganizer，同时用作骨骼组节点名） ────────── */
  root: '根节点',
  torso: '躯干',
  neck: '脖子',
  leftArm: '左臂',
  rightArm: '右臂',
  leftElbow: '左肘',
  rightElbow: '右肘',
  bothArms: '双臂',
  leftLeg: '左腿',
  rightLeg: '右腿',
  leftKnee: '左膝',
  rightKnee: '右膝',
  bothLegs: '双腿',

  /* ── 部件标签（KNOWN_TAGS） ────────────────────────────────────── */
  'back hair': '后发',
  'front hair': '前发',
  headwear: '头饰',
  face: '脸部',
  irides: '虹膜',
  eyebrow: '眉毛',
  eyewhite: '眼白',
  eyelash: '睫毛',
  eyewear: '眼镜',
  ears: '耳朵',
  earwear: '耳饰',
  nose: '鼻子',
  mouth: '嘴巴',
  neckwear: '颈饰',
  topwear: '上衣',
  handwear: '手套',
  bottomwear: '下装',
  legwear: '腿部服饰',
  footwear: '鞋子',
  tail: '尾巴',
  wings: '翅膀',
  objects: '物件',
  // V1/V2 整层眼睛
  eyel: '左眼',
  eyer: '右眼',

  /* ── 弯曲变形器（WARP_SPECS.warpName） ─────────────────────────── */
  FaceWarp: '脸部弯曲',
  BodyWarp: '身体弯曲',
  NeckWarp: '脖子弯曲',
  EyeLWarp: '左眼弯曲',
  EyeRWarp: '右眼弯曲',
  MouthWarp: '嘴部弯曲',
  EyebrowLWarp: '左眉弯曲',
  EyebrowRWarp: '右眉弯曲',
  HairFrontWarp: '前发弯曲',
  HairBackWarp: '后发弯曲',
  TopWearWarp: '上衣弯曲',
  BottomWearWarp: '下装弯曲',
  BreathWarp: '呼吸弯曲',
  BodyWarpY: '身体弯曲 Y',
  BodyWarpZ: '身体弯曲 Z',

  /* ── Live2D 标准参数（LIVE_RIG_PARAMS.name） ───────────────────── */
  'Angle X': '角度 X',
  'Angle Y': '角度 Y',
  'Angle Z': '角度 Z',
  'Eye L Open': '左眼开合',
  'Eye R Open': '右眼开合',
  'Eye L Smile': '左眼微笑',
  'Eye R Smile': '右眼微笑',
  'Eyeball X': '眼球 X',
  'Eyeball Y': '眼球 Y',
  'Eyeball Form': '眼球形状',
  Tear: '眼泪',
  'Brow L Y': '左眉 Y',
  'Brow R Y': '右眉 Y',
  'Brow L X': '左眉 X',
  'Brow R X': '右眉 X',
  'Brow L Angle': '左眉角度',
  'Brow R Angle': '右眉角度',
  'Brow L Form': '左眉形状',
  'Brow R Form': '右眉形状',
  'Mouth Form': '嘴型',
  'Mouth Open': '张嘴',
  'Body Angle X': '身体角度 X',
  'Body Angle Y': '身体角度 Y',
  'Body Angle Z': '身体角度 Z',
  Breath: '呼吸',
  'Arm L A': '左臂 A',
  'Arm R A': '右臂 A',
  'Arm L B': '左臂 B',
  'Arm R B': '右臂 B',
  'Hand L': '左手',
  'Hand R': '右手',
  'Shoulder Y': '肩膀 Y',
  'Bust X': '胸部 X',
  'Bust Y': '胸部 Y',
  'Hair Front': '前发',
  'Hair Side': '侧发',
  'Hair Back': '后发',
  Cheek: '脸颊',
  'Hair Fluffy': '发丝蓬松',
  'Base X': '基础 X',
  'Base Y': '基础 Y',

  /* ── 物理规则预设（cmo3/physics.js） ───────────────────────────── */
  Skirt: '裙子',
  Shirt: '衬衫',
  Pants: '裤子',
  Bust: '胸部',
  'Arm Sway': '手臂摆动',

  /* ── 应用自动生成的其他名称 ────────────────────────────────────── */
  Group: '组',
  Idle: '待机',
  Parameters: '参数动画',

  /* ── 动作预设（io/motionPresets.js，同时用于动画名称显示） ──────── */
  'Casual Idle': '休闲待机',
  Walk: '走路',
  'Lie Down': '躺下',
  'Fall Down': '倒下',
  'Draw Sword': '拔剑',
  'Swing Sword': '挥剑',
  'Shoot Gun': '开枪',
  'Cast Spell': '挥动法杖',
  'Hold Shield': '拿盾',
};

/** 左右侧别后缀（用于 name-l / name-r 形式的标签） */
const SIDE_LABELS = { l: '左', r: '右' };

/**
 * 将英文数据名转换为当前语言的显示名。
 * 找不到映射时原样返回，保证用户自定义名称不受影响。
 *
 * @param {string} name 数据中的原始名称
 * @param {'en'|'zh'} [lang='zh'] 当前语言；非中文直接返回原名（英文界面维持原状）
 * @returns {string} 显示用名称
 */
export function labelFor(name, lang = 'zh') {
  // 仅中文需要映射；空值或非字符串一律原样返回
  if (!name || typeof name !== 'string' || lang !== 'zh') return name;

  // 1) 精确匹配
  if (ZH_NAMES[name]) return ZH_NAMES[name];

  // 2) 复制节点：“xxx Copy” → “中文名 副本”
  const copyMatch = /^(.*) Copy$/.exec(name);
  if (copyMatch && ZH_NAMES[copyMatch[1]]) {
    return `${ZH_NAMES[copyMatch[1]]} 副本`;
  }

  // 3) 左右变体：“handwear-l” → “手套（左）”
  const sideMatch = /^(.*)-([lr])$/.exec(name);
  if (sideMatch) {
    const base = ZH_NAMES[sideMatch[1]];
    if (base) return `${base}（${SIDE_LABELS[sideMatch[2]]}）`;
  }

  // 4) 前缀变体：“front hair 2” → “前发 2”，保留原始后缀
  for (const key of Object.keys(ZH_NAMES)) {
    if (name.startsWith(`${key} `) || name.startsWith(`${key}-`) || name.startsWith(`${key}_`)) {
      return ZH_NAMES[key] + name.slice(key.length);
    }
  }

  // 5) 未收录，回退原名
  return name;
}

export { ZH_NAMES };

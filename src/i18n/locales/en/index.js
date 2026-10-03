/**
 * 英文语言包聚合入口。
 * 各命名空间通过独立文件维护，便于并行开发与按需拆分。
 */
import common from './common';
import editor from './editor';
import panels from './panels';
import timeline from './timeline';
import io from './io';
import canvas from './canvas';

export default {
  common,
  editor,
  panels,
  timeline,
  io,
  canvas,
};

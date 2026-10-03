import { useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Circle, Scissors } from 'lucide-react';
import {
  loadDWPoseSession, runDWPose, buildArmatureNodes, analyzeGroups,
  matchTag, estimateSkeletonFromBounds, DWPOSE_URL, clearDWPoseSession,
  KNOWN_TAGS, autoRearrangeLayers,
} from '../../io/armatureOrganizer';
import { splitLayerLR } from '../../io/splitLR';
import { HelpIcon } from '../ui/help-icon';
import { useToast } from '../../hooks/use-toast';
import { useTranslation } from '@/i18n';

/** Base ranges for the strength slider — keyed by param id */
const LIVE_RIG_BASE = {
  ParamAngleX:     { min: -30, max:  30 },
  ParamAngleY:     { min: -30, max:  30 },
  ParamAngleZ:     { min: -30, max:  30 },
  ParamEyeLOpen:   { min:   0, max:   1 },
  ParamEyeROpen:   { min:   0, max:   1 },
  ParamEyeBallX:   { min:  -1, max:   1 },
  ParamEyeBallY:   { min:  -1, max:   1 },
  ParamBrowLY:     { min:  -1, max:   1 },
  ParamBrowRY:     { min:  -1, max:   1 },
  ParamMouthForm:  { min:  -1, max:   1 },
  ParamMouthOpenY: { min:   0, max:   1 },
  ParamBodyAngleX: { min: -10, max:  10 },
  ParamBodyAngleY: { min: -10, max:  10 },
  ParamBodyAngleZ: { min: -10, max:  10 },
  ParamBreath:     { min:   0, max:   1 },
  ParamHairFront:  { min:  -1, max:   1 },
  ParamHairSide:   { min:  -1, max:   1 },
  ParamHairBack:   { min:  -1, max:   1 },
};

/** liverig 参数分组名 → i18n 键后缀 的映射（分组名同时用作分组键，保持英文） */
const LIVERIG_GROUP_KEYS = {
  Face: 'face',
  Eye: 'eye',
  Eyeball: 'eyeball',
  Brow: 'brow',
  Mouth: 'mouth',
  Body: 'body',
  Hair: 'hair',
  Other: 'other',
};

export default function PsdImportWizard({
  step,
  onSetStep,
  pendingPsd,
  onnxSessionRef,
  onFinalize,
  onSkip,
  onCancel,
  onComplete,
  onBack,
  onReorder,
  onApplyRig,
  onUpdatePsd,
  onLiveRig,
  liveRigParams,
  onWarpStrength,
}) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [rigStatus, setRigStatus] = useState('');
  const [rigStatusIsError, setRigStatusIsError] = useState(false);
  const [rigLoading, setRigLoading] = useState(false);
  const [tagOverrides, setTagOverrides] = useState({});
  const [mappingExpanded, setMappingExpanded] = useState(false);
  const [splitError, setSplitError] = useState('');
  const [meshAllParts, setMeshAllParts] = useState(true);
  const [performSplit, setPerformSplit] = useState(true);

  const { psdW, psdH, layers, partIds } = pendingPsd || {};

  /* ── Effective layers: apply tag overrides by renaming to canonical tag ── */
  const effectiveLayers = layers
    ? layers.map(l =>
      tagOverrides[l.name] ? { ...l, name: tagOverrides[l.name] } : l
    )
    : [];

  const matchCount = effectiveLayers.filter(l => matchTag(l.name) !== null).length;
  const unmatchedLayers = layers
    ? layers.filter(l => {
      const effective = tagOverrides[l.name] ?? null;
      if (effective !== null) return false; // user-assigned
      return matchTag(l.name) === null;
    })
    : [];
  const tooFew = matchCount < 4;

  /* ── Detect merged parts (left/right present but no -l or -r) ── */
  const SPLIT_CANDIDATES = ['handwear', 'legwear', 'footwear', 'irides', 'eyebrow', 'eyewhite', 'eyelash', 'ears'];
  
  const mergedTagsToSplit = effectiveLayers ? SPLIT_CANDIDATES.filter(baseTag => {
    const hasBase = effectiveLayers.some(l => matchTag(l.name) === baseTag);
    const hasL = effectiveLayers.some(l => matchTag(l.name) === `${baseTag}-l`);
    const hasR = effectiveLayers.some(l => matchTag(l.name) === `${baseTag}-r`);
    return hasBase && !hasL && !hasR;
  }) : [];

  const partsMerged = mergedTagsToSplit.length > 0;

  /* ── Handle tag override dropdown change ────────────────────────────────── */
  const handleTagChange = useCallback((layerName, value) => {
    setTagOverrides(prev => {
      const next = { ...prev };
      if (value === '') {
        delete next[layerName];
      } else {
        next[layerName] = value;
      }
      return next;
    });
  }, []);

  const executeSplit = useCallback(() => {
    setSplitError('');
    const failedMsgs = [];
    const splits = [];

    for (const baseTag of mergedTagsToSplit) {
      const mergedIdx = effectiveLayers.findIndex(l => matchTag(l.name) === baseTag);
      if (mergedIdx === -1) continue;

      const mergedLayer = effectiveLayers[mergedIdx];
      const result = splitLayerLR(mergedLayer, psdW, psdH);

      if (!result.right && !result.left) {
        failedMsgs.push(baseTag);
        continue;
      }

      const rightLayer = result.right ? {
        ...mergedLayer,
        name: `${baseTag}-r`,
        imageData: result.right.imageData,
        x: result.right.x,
        y: result.right.y,
        width: result.right.width,
        height: result.right.height,
      } : null;

      const leftLayer = result.left ? {
        ...mergedLayer,
        name: `${baseTag}-l`,
        imageData: result.left.imageData,
        x: result.left.x,
        y: result.left.y,
        width: result.left.width,
        height: result.left.height,
      } : null;

      splits.push({ mergedIdx, rightLayer, leftLayer });
    }

    if (failedMsgs.length > 0) {
      const errorMsg = t('canvas.wizard.split.error', { names: failedMsgs.join(', ') });
      setSplitError(errorMsg);
      toast({
        title: t('canvas.wizard.split.partialTitle'),
        description: errorMsg,
        variant: "default",
      });
    }

    return splits;
  }, [effectiveLayers, mergedTagsToSplit, psdW, psdH, toast, t]);

  /* ── Handle manual rigging (bounding-box heuristic) ────────────────────── */
  const handleRigManually = useCallback(async () => {
    setRigLoading(true);
    setRigStatusIsError(false);
    try {
      const layerMap = {};
      effectiveLayers.forEach(l => {
        const key = l.name.toLowerCase().trim();
        layerMap[key] = l;
      });
      const groups = analyzeGroups(layerMap);

      const skeleton = estimateSkeletonFromBounds(effectiveLayers, psdW, psdH);
      const { groupDefs, assignments } = buildArmatureNodes(skeleton, groups, effectiveLayers, partIds, () => {
        return `grp-${Math.random().toString(36).substr(2, 9)}`;
      });

      if (step === 'reorder') {
        onApplyRig(groupDefs, assignments, meshAllParts);
      } else {
        onFinalize(groupDefs, assignments, meshAllParts);
      }
    } catch (err) {
      console.error('[Manual Rig]', err);
      setRigStatusIsError(true);
      setRigStatus(err.message);
    } finally {
      setRigLoading(false);
    }
  }, [step, effectiveLayers, psdW, psdH, partIds, meshAllParts, onFinalize, onApplyRig]);

  /* ── Handle DWPose rigging ────────────────────────────────────────────── */
  const runArmatureRig = useCallback(async (onnxPayload) => {
    setRigLoading(true);
    setRigStatusIsError(false);
    try {
      setRigStatus(t('canvas.wizard.status.loadingOnnx'));
      const session = await loadDWPoseSession(onnxPayload);
      onnxSessionRef.current = session;

      const layerMap = {};
      effectiveLayers.forEach(l => {
        const key = l.name.toLowerCase().trim();
        layerMap[key] = l;
      });
      const groups = analyzeGroups(layerMap);

      const skeleton = await runDWPose(effectiveLayers, psdW, psdH, session, setRigStatus);

      setRigStatus(t('canvas.wizard.status.buildingRig'));
      const { groupDefs, assignments } = buildArmatureNodes(skeleton, groups, effectiveLayers, partIds, () => {
        return `grp-${Math.random().toString(36).substr(2, 9)}`;
      });

      if (step === 'reorder' || step === 'dwpose' || step === 'adjust') {
        onApplyRig(groupDefs, assignments, meshAllParts);
      } else {
        onFinalize(groupDefs, assignments, meshAllParts);
      }
    } catch (err) {
      console.error('[AutoRig]', err);
      setRigStatusIsError(true);
      setRigStatus(err.message);
      clearDWPoseSession();
    } finally {
      setRigLoading(false);
    }
  }, [step, effectiveLayers, psdW, psdH, partIds, meshAllParts, onFinalize, onApplyRig, onnxSessionRef, t]);

  /* ── Effect: Auto-rearrange eye layers ────────────────────────────────── */
  useEffect(() => {
    if (!layers || !partIds || !onUpdatePsd) return;
    const result = autoRearrangeLayers(layers, partIds);
    if (result) {
      onUpdatePsd(result);
      toast({
        title: t('canvas.wizard.autoRearrange.title'),
        description: t('canvas.wizard.autoRearrange.description'),
      });
    }
  }, [layers, partIds, onUpdatePsd, toast, t]);

  /* ── Step: Review layer mapping ─────────────────────────────────────── */
  if (step === 'review') {
    const layerMappings = layers
      ? layers.map(l => ({
        layer: l,
        tag: tagOverrides[l.name] ?? matchTag(l.name),
        overridden: l.name in tagOverrides,
      }))
      : [];

    const hasWarnings = unmatchedLayers.length > 0;
    const allMatched = unmatchedLayers.length === 0;

    // When user clicks Continue, enter the reorder step
    const handleContinue = () => {
      const splits = (partsMerged && performSplit) ? executeSplit() : [];
      onReorder(splits);
    };

    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-popover border border-border rounded-lg shadow-2xl p-6 max-w-md w-full mx-4 flex flex-col gap-4">
          <h3 className="text-base font-semibold text-foreground">{t('canvas.wizard.review.title')}</h3>

          {/* Collapsed summary row */}
          <button
            onClick={() => setMappingExpanded(v => !v)}
            className="flex items-center gap-2 w-full text-left px-3 py-2 rounded border border-border hover:bg-muted transition-colors"
          >
            {tooFew ? (
              <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            ) : allMatched ? (
              <CheckCircle size={14} className="text-green-500 shrink-0" />
            ) : (
              <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            )}
            <span className="flex-1 text-xs text-foreground">
              {t('canvas.wizard.review.matched', { matched: matchCount, total: layers.length })}
              {hasWarnings && (
                <span className="text-amber-400 ml-1">
                  · {t('canvas.wizard.review.unmatchedCount', { count: unmatchedLayers.length })}
                </span>
              )}
              {tooFew && (
                <span className="text-amber-400 ml-1">· {t('canvas.wizard.review.tooFewInline')}</span>
              )}
            </span>
            {mappingExpanded
              ? <ChevronDown size={13} className="text-muted-foreground shrink-0" />
              : <ChevronRight size={13} className="text-muted-foreground shrink-0" />
            }
          </button>

          {/* Expanded layer table */}
          {mappingExpanded && (
            <div className="border border-border rounded overflow-hidden">
              <div className="max-h-56 overflow-y-auto">
                {layerMappings.map(({ layer, tag, overridden }) => (
                  <div
                    key={layer.name}
                    className="flex items-center gap-2 px-2 py-1 border-b border-border last:border-b-0 hover:bg-muted/50"
                  >
                    {/* Status icon */}
                    <span className="shrink-0">
                      {tag !== null ? (
                        <CheckCircle size={11} className={overridden ? 'text-blue-400' : 'text-green-500'} />
                      ) : (
                        <Circle size={11} className="text-amber-400" />
                      )}
                    </span>

                    {/* Layer name */}
                    <span
                      className="flex-1 text-[11px] text-muted-foreground truncate"
                      title={layer.name}
                    >
                      {layer.name}
                    </span>

                    {/* Tag dropdown */}
                    <select
                      value={tagOverrides[layer.name] ?? (matchTag(layer.name) ?? '')}
                      onChange={e => handleTagChange(layer.name, e.target.value)}
                      className={[
                        'text-[11px] rounded border px-1 py-0.5 bg-background outline-none shrink-0',
                        tag !== null
                          ? 'border-border text-foreground'
                          : 'border-amber-500/50 text-amber-400',
                      ].join(' ')}
                    >
                      <option value="">{t('canvas.wizard.review.unassigned')}</option>
                      {KNOWN_TAGS.map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warning messages */}
          {tooFew && (
            <p className="text-[11px] text-amber-400 leading-relaxed">
              {t('canvas.wizard.review.tooFewWarning')}
            </p>
          )}

          {/* Split parts toggle (only if merged parts detected) */}
          {partsMerged && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  checked={performSplit}
                  onChange={e => setPerformSplit(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border border-border"
                />
                <span>{t('canvas.wizard.review.splitMerged')}</span>
              </label>
              {splitError && (
                <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-amber-300 leading-relaxed">{splitError}</p>
                </div>
              )}
            </div>
          )}

          {/* Mesh all parts checkbox */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            <input
              type="checkbox"
              checked={meshAllParts}
              onChange={e => setMeshAllParts(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-border"
            />
            <span>{t('canvas.wizard.review.meshAllParts')}</span>
          </label>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border pt-3 gap-1.5">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {t('canvas.wizard.review.cancelImport')}
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const splits = (partsMerged && performSplit) ? executeSplit() : [];
                  onSkip(meshAllParts, splits);
                }}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                {t('canvas.wizard.review.skipRigging')}
              </button>
              <button
                onClick={handleContinue}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium shrink-0"
              >
                {t('canvas.wizard.review.continue')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }




  /* ── Step: Reorder Layers (floating toolbar) ───────────────────────── */
  if (step === 'reorder') {
    return (
      <div className="absolute top-0 inset-x-0 z-40 flex items-center gap-4 px-4 py-2
                      bg-background border-b border-border
                      animate-in fade-in slide-in-from-top-2 duration-300 ease-out">
        <span className="text-xs font-semibold text-foreground">{t('canvas.wizard.reorder.title')}</span>
        <span className="text-xs text-muted-foreground flex-1">
          {t('canvas.wizard.reorder.description')}
        </span>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={handleRigManually}
          className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          {t('canvas.wizard.reorder.next')}
        </button>
      </div>
    );
  }

  /* ── Step: DWPose loading ─────────────────────────────────────────── */
  if (step === 'dwpose') {
    const modelLoaded = !!onnxSessionRef?.current;
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-popover border border-border rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{t('canvas.wizard.dwpose.title')}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('canvas.wizard.dwpose.description')}
            </p>
          </div>

          {/* Model status */}
          <div className="p-2 rounded bg-muted border border-border">
            <p className="text-xs text-muted-foreground">
              {t('canvas.wizard.dwpose.statusLabel')} {modelLoaded ? (
                <span className="text-green-500 font-medium">{t('canvas.wizard.dwpose.loaded')}</span>
              ) : (
                <span className="text-amber-500">{t('canvas.wizard.dwpose.notLoaded')}</span>
              )}
            </p>
          </div>

          {/* Load buttons */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('canvas.wizard.dwpose.loadModel')}</div>
            <div className="flex gap-2">
              {/* Local .onnx file */}
              <label className={[
                'flex-1 text-center px-3 py-1.5 text-xs rounded border cursor-pointer transition-colors',
                rigLoading
                  ? 'opacity-40 pointer-events-none border-border text-muted-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
              ].join(' ')}>
                {t('canvas.wizard.dwpose.loadOnnx')}
                <input
                  type="file" accept=".onnx" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    runArmatureRig(await f.arrayBuffer());
                  }}
                  disabled={rigLoading}
                />
              </label>

              {/* Download from HuggingFace */}
              <button
                disabled={rigLoading}
                className="flex-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-40"
                onClick={() => runArmatureRig(DWPOSE_URL)}
              >
                {rigLoading ? t('canvas.wizard.dwpose.working') : t('canvas.wizard.dwpose.download')}
              </button>
            </div>

            {/* Status */}
            {rigStatus && (
              <p className={[
                'text-[11px] px-1',
                rigStatusIsError ? 'text-red-400' : 'text-muted-foreground',
              ].join(' ')}>
                {rigStatusIsError ? `${t('common.error')}: ${rigStatus}` : rigStatus}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between border-t border-border pt-3">
            <button
              disabled={rigLoading}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              onClick={() => onSetStep('adjust')}
            >
              ← {t('common.back')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Step: Adjust joints (floating toolbar) ────────────────────────── */
  if (step === 'adjust') {
    return (
      <div className="absolute top-0 inset-x-0 z-40 flex items-center gap-4 px-4 py-2
                      bg-background border-b border-border
                      animate-in fade-in slide-in-from-top-2 duration-300 ease-out">
        <span className="text-xs font-semibold text-foreground">{t('canvas.wizard.adjust.title')}</span>
        <span className="text-xs text-muted-foreground flex-1">
          {t('canvas.joints.hint')}
        </span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors shrink-0">
          <input
            type="checkbox"
            checked={meshAllParts}
            onChange={e => setMeshAllParts(e.target.checked)}
            className="w-3.5 h-3.5 rounded border border-border"
          />
          <span>{t('canvas.wizard.adjust.meshAllParts')}</span>
        </label>
        <button
          onClick={() => onSetStep('dwpose')}
          className="px-2 py-1 text-xs rounded border border-primary/50 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5"
        >
          <Scissors size={12} />
          {t('canvas.wizard.adjust.autoRig')}
        </button>
        <button
          onClick={onBack}
          className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          ← {t('common.back')}
        </button>
        <button
          onClick={() => onLiveRig(meshAllParts)}
          className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          {t('canvas.wizard.adjust.next')}
        </button>
      </div>
    );
  }

  /* ── Step: Live2D parameter setup ──────────────────────────────────────── */
  if (step === 'liverig') {
    // Group params by their group label, preserving order
    const groups = [];
    const groupMap = {};
    for (const param of (liveRigParams ?? [])) {
      // Find the base spec to know this param's group
      const base = LIVE_RIG_BASE[param.id];
      if (!base) continue;
      // Derive group name from the base table key pattern
      const groupName = (
        ['ParamAngleX','ParamAngleY','ParamAngleZ'].includes(param.id)         ? 'Face'    :
        ['ParamEyeLOpen','ParamEyeROpen'].includes(param.id)                    ? 'Eye'     :
        ['ParamEyeBallX','ParamEyeBallY'].includes(param.id)                    ? 'Eyeball' :
        ['ParamBrowLY','ParamBrowRY'].includes(param.id)                        ? 'Brow'    :
        ['ParamMouthForm','ParamMouthOpenY'].includes(param.id)                 ? 'Mouth'   :
        ['ParamBodyAngleX','ParamBodyAngleY','ParamBodyAngleZ','ParamBreath'].includes(param.id) ? 'Body' :
        ['ParamHairFront','ParamHairSide','ParamHairBack'].includes(param.id)   ? 'Hair'    :
        'Other'
      );
      if (!groupMap[groupName]) {
        groupMap[groupName] = [];
        groups.push(groupName);
      }
      groupMap[groupName].push({ param, base });
    }

    return (
      <div className="absolute left-0 top-0 bottom-0 z-40 flex flex-col w-72
                      bg-popover border-r border-border shadow-2xl
                      animate-in fade-in slide-in-from-left-4 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-xs font-semibold text-foreground">{t('canvas.wizard.liverig.title')}</span>
          <span className="text-[10px] text-muted-foreground">{t('canvas.wizard.liverig.previewPlaying')}</span>
        </div>

        {/* Scrollable parameter list */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {liveRigParams?.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-4 text-center">{t('canvas.wizard.liverig.generating')}</p>
          )}
          {groups.map(groupName => (
            <div key={groupName}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('canvas.wizard.liverig.group.' + (LIVERIG_GROUP_KEYS[groupName] ?? 'other'))}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-1">
                {groupMap[groupName].map(({ param, base }) => {
                  // Compute current strength from actual param min/max vs base
                  const baseRange = base.max === base.min ? 1 : Math.abs(base.max - base.min);
                  const actualRange = Math.abs(param.max - param.min);
                  const strength = Math.round((actualRange / (baseRange || 1)) * 100);

                  return (
                    <div key={param.id} className="flex items-center gap-2">
                      <span className="text-[11px] text-foreground w-24 shrink-0 truncate" title={param.name}>
                        {param.name}
                      </span>
                      <input
                        type="range"
                        min={0} max={100} step={5}
                        value={strength}
                        onChange={e => onWarpStrength(param.id, Number(e.target.value))}
                        className="flex-1 h-1 accent-primary"
                      />
                      <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
                        {strength}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 shrink-0">
          <button
            onClick={() => onComplete(meshAllParts)}
            className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {t('canvas.wizard.liverig.skip')}
          </button>
          <button
            onClick={() => onComplete(meshAllParts)}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
          >
            {t('canvas.wizard.liverig.done')}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import {
  exportFrames,
  computeExportFrameSpecs,
  computeAnalyticalBounds,
  resolveAnimations,
} from '@/io/exportAnimation';
import { exportLive2D, exportLive2DProject } from '@/io/live2d';
import { PhysicsPanel } from '@/components/physics/PhysicsPanel';
import { useTranslation } from '@/i18n';
import { labelFor } from '@/i18n/labels';

export function ExportModal({ open, onClose, captureRef, projectName, projectId }) {
  const { t, lang } = useTranslation();
  // Form state
  const [type, setType] = useState('sequence');
  const [format, setFormat] = useState('png');
  const [animTarget, setAnimTarget] = useState('current');
  const [exportFps, setExportFps] = useState(24);
  const [frameIndex, setFrameIndex] = useState(0);
  const [imageContains, setImageContains] = useState('canvas_area');
  const [outputScale, setOutputScale] = useState(100);
  const [bgMode, setBgMode] = useState('transparent');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [exportDest, setExportDest] = useState('zip');
  const [modelName, setModelName] = useState('model');
  const [atlasSize, setAtlasSize] = useState(2048);
  const [generateRig, setGenerateRig] = useState(true);
  const [generatePhysics, setGeneratePhysics] = useState(true);
  // Per-category toggles (on = category emitted, off = all rules in that
  // category skipped). Use case: characters like shelby with a buzz cut
  // still have `front hair` / `back hair` tags, so the requireTag auto-skip
  // doesn't catch them — user has to manually opt out of hair physics.
  const [physicsHair, setPhysicsHair] = useState(true);
  const [physicsClothing, setPhysicsClothing] = useState(true);
  const [physicsBust, setPhysicsBust] = useState(true);
  const [physicsArms, setPhysicsArms] = useState(true);
  const [showPhysicsRules, setShowPhysicsRules] = useState(false);
  // Track whether user has explicitly edited the model-name field. While
  // untouched, the field auto-syncs to the current project's name on every
  // open — so loading a new project and then exporting shows the right default.
  const [modelNameTouched, setModelNameTouched] = useState(false);

  // Progress state
  const [progress, setProgress] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  // Store access
  const project = useProjectStore(s => s.project);
  const animStore = useAnimationStore();

  // Sync defaults when modal opens
  useEffect(() => {
    if (!open) return;
    if (project.animations.length === 0) {
      setAnimTarget('staging');
    } else if (animTarget === 'current' && !animStore.activeAnimationId) {
      // If no active anim, just keep it on what it determines or staging if empty
    }
    const activeAnim = project.animations.find(a => a.id === animStore.activeAnimationId);
    setExportFps(activeAnim?.fps ?? animStore.fps ?? 24);
    const hasBg = project.canvas.bgEnabled;
    setBgMode(hasBg ? 'custom' : 'transparent');
    setBgColor(project.canvas.bgColor ?? '#ffffff');
    // Default model name to the loaded project name (sanitized for filename
    // safety). Only applies while the user hasn't manually edited the field.
    if (!modelNameTouched) {
      const candidate = (projectName || '').trim();
      const sanitized = candidate
        ? candidate.replace(/[\\/:*?"<>|]/g, '').trim() || 'model'
        : 'model';
      setModelName(sanitized);
    }
  }, [open, project, animStore, animTarget, projectName, modelNameTouched]);

  // Reset manual-edit tracker when a new project loads so its name gets
  // auto-applied the next time the modal opens.
  useEffect(() => {
    setModelNameTouched(false);
  }, [projectId]);

  const handleLive2DExport = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);
    setProgress({ current: 0, total: 1, label: t('io.export.progressLoadingTextures') });

    try {
      // Load texture images from blob URLs
      const images = new Map();
      for (const tex of project.textures) {
        if (!tex.source) continue;
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => { images.set(tex.id, img); resolve(); };
          img.onerror = reject;
          img.src = tex.source;
        });
      }

      const name = modelName.trim() || 'model';

      if (type === 'live2d_project') {
        // .cmo3 project export (editable in Cubism Editor)
        const physicsDisabledCategories = [
          !physicsHair && 'hair',
          !physicsClothing && 'clothing',
          !physicsBust && 'bust',
          !physicsArms && 'arms',
        ].filter(Boolean);
        const blob = await exportLive2DProject(project, images, {
          modelName: name,
          generateRig,
          generatePhysics,
          physicsDisabledCategories,
          onProgress: (msg) =>
            setProgress(p => (p ? { ...p, label: msg } : null)),
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Exporter bundles as ZIP when animations OR rig debug log are present.
        // Detect via MIME type: zips come back as application/zip, bare .cmo3 as octet-stream.
        const isZip = blob.type === 'application/zip' || blob.type === 'application/x-zip-compressed';
        const hasAnims = project.animations?.length > 0;
        a.download = (isZip || hasAnims || generateRig) ? `${name}_live2d.zip` : `${name}.cmo3`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // .moc3 runtime export (ZIP with atlas)
        const blob = await exportLive2D(project, images, {
          modelName: name,
          atlasSize,
          exportMotions: true,
          onProgress: (msg) =>
            setProgress(p => (p ? { ...p, label: msg } : null)),
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}_live2d.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }

      setProgress(null);
      setIsExporting(false);
      onClose();
    } catch (err) {
      console.error('[Live2D Export] Failed:', err);
      setExportError(err.message || t('io.export.exportFailed'));
      setProgress(null);
      setIsExporting(false);
    }
  }, [project, modelName, atlasSize, type, generateRig, generatePhysics, physicsHair, physicsClothing, physicsBust, physicsArms, onClose, t]);

  const handleExport = useCallback(async () => {
    if (type === 'live2d' || type === 'live2d_project') {
      return handleLive2DExport();
    }

    if (!captureRef?.current) {
      console.error('[Export] captureRef not available');
      return;
    }

    setIsExporting(true);
    setProgress({ current: 0, total: 1, label: t('io.export.progressPreparing') });

    try {
      // Resolve which animations to export
      const animsToExport = resolveAnimations(
        project.animations,
        animTarget,
        animStore.activeAnimationId
      );

      if (type === 'spine') {
        const { exportToSpine } = await import('@/io/exportSpine');
        const zipBlob = await exportToSpine({
          project,
          onProgress: label => setProgress(p => p ? { ...p, label } : { current: 1, total: 1, label })
        });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spine_export.zip';
        a.click();
        URL.revokeObjectURL(url);
        setProgress(null);
        setIsExporting(false);
        return;
      }

      if (animsToExport.length === 0) {
        setProgress(null);
        setIsExporting(false);
        alert(t('io.export.noTargetSelected'));
        return;
      }

      // Compute frame specs
      const frameSpecs = computeExportFrameSpecs({
        type,
        animsToExport,
        exportFps,
        frameIndex,
      });

      // Compute export dimensions
      const scale = outputScale / 100;
      let cropOffset = null;
      let exportW, exportH;

      if (imageContains === 'min_image_area') {
        const bounds = computeAnalyticalBounds(project);
        exportW = Math.round(
          (bounds?.width ?? project.canvas.width) * scale
        );
        exportH = Math.round(
          (bounds?.height ?? project.canvas.height) * scale
        );
        cropOffset = bounds ? { x: bounds.x, y: bounds.y } : null;
      } else {
        exportW = Math.round(project.canvas.width * scale);
        exportH = Math.round(project.canvas.height * scale);
      }

      // Capture each frame
      const frameDataItems = [];
      const total = frameSpecs.length;

      for (let i = 0; i < total; i++) {
        const spec = frameSpecs[i];
        setProgress({
          current: i + 1,
          total,
          label: t('io.export.frameProgress', {
            name: spec.animName,
            frame: spec.frameIndex + 1,
          }),
        });

        const dataUrl = captureRef.current({
          animId: spec.animId,
          timeMs: spec.timeMs,
          bgEnabled: bgMode === 'custom',
          bgColor,
          exportWidth: exportW,
          exportHeight: exportH,
          format,
          quality: 0.92,
          cropOffset,
        });

        if (dataUrl) {
          frameDataItems.push({
            animName: spec.animName,
            frameIndex: spec.frameIndex,
            dataUrl,
          });
        }

        // Yield to browser for rAF and UI updates
        await new Promise(r => setTimeout(r, 0));
      }

      // Export to ZIP or Folder
      setProgress({
        current: total,
        total,
        label: t('io.export.progressWritingOutput'),
      });

      await exportFrames({
        frames: frameDataItems,
        format,
        exportDest,
        onProgress: msg =>
          setProgress(p => (p ? { ...p, label: msg } : null)),
      });

      setProgress(null);
      setIsExporting(false);
    } catch (err) {
      console.error('[Export] Failed:', err);
      setExportError(err.message || t('io.export.exportFailed'));
      setProgress(null);
      setIsExporting(false);
    }
  }, [
    captureRef,
    project,
    animStore,
    type,
    format,
    animTarget,
    exportFps,
    frameIndex,
    imageContains,
    outputScale,
    bgMode,
    bgColor,
    exportDest,
    onClose,
    handleLive2DExport,
    t,
  ]);

  const isLive2D = type === 'live2d' || type === 'live2d_project';
  const isSpine = type === 'spine';
  const showFpsInput = type === 'sequence';
  const showFrameInput = type === 'single_frame';
  const hasFolderSupport = 'showDirectoryPicker' in window;
  const showJpgWarning = format === 'jpg' && bgMode === 'transparent' && !isLive2D && !isSpine;

  // Calculate range for frame slider
  const targetAnims = resolveAnimations(
    project.animations,
    animTarget,
    animStore.activeAnimationId
  );
  const maxDuration =
    targetAnims.length > 0
      ? Math.max(...targetAnims.map(a => a.duration ?? 2000))
      : 0;
  // Frames are calculated as durationMs / 1000 * fps
  // Mimic computeExportFrameSpecs logic for consistency
  const totalFrames =
    targetAnims.length > 0
      ? Math.max(1, Math.round((maxDuration / 1000) * exportFps))
      : 0;
  const maxFrameIndex = Math.max(0, totalFrames - 1);
  const hasFrames = totalFrames > 0;

  // Clamp frameIndex if range changes
  useEffect(() => {
    if (frameIndex > maxFrameIndex) {
      setFrameIndex(maxFrameIndex);
    }
  }, [maxFrameIndex, frameIndex]);

  return (
    <Dialog open={open} onOpenChange={v => {
      if (!v && !isExporting) onClose();
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('io.export.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Section 1: Type + Format */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('io.export.labelType')}</Label>
              <Select value={type} onValueChange={v => { setType(v); setExportError(null); }} disabled={isExporting}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequence">{t('io.export.typeSequence')}</SelectItem>
                  <SelectItem value="single_frame">{t('io.export.typeSingleFrame')}</SelectItem>
                  <SelectItem value="live2d_project">{t('io.export.typeLive2DProject')}</SelectItem>
                  <SelectItem value="live2d">{t('io.export.typeLive2DRuntime')}</SelectItem>
                  <SelectItem value="spine">{t('io.export.typeSpine')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isLive2D && !isSpine && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('io.export.labelFormat')}</Label>
                <Select value={format} onValueChange={setFormat} disabled={isExporting}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="webp">WEBP</SelectItem>
                    <SelectItem value="jpg">JPG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Live2D-specific options */}
          {isLive2D && (
            <>
              <Separator />
              <div className="space-y-3">
                {type === 'live2d' && (
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 px-3 py-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-800/40">
                    <span className="font-bold block mb-0.5">{t('io.export.testingOnly')}</span>
                    {t('io.export.runtimeWarningPrefix')} <strong>Live2D Project</strong> {t('io.export.runtimeWarningSuffix')}
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t('io.export.labelModelName')}</Label>
                  <Input
                    className="h-8 text-xs"
                    value={modelName}
                    onChange={e => {
                      setModelName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_'));
                      setModelNameTouched(true);
                    }}
                    disabled={isExporting}
                    placeholder={t('io.export.placeholderModelName')}
                  />
                </div>
                {type !== 'live2d_project' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t('io.export.labelAtlasSize')}</Label>
                    <Select value={String(atlasSize)} onValueChange={v => setAtlasSize(Number(v))} disabled={isExporting}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1024">1024</SelectItem>
                        <SelectItem value="2048">2048</SelectItem>
                        <SelectItem value="4096">4096</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {type === 'live2d_project' && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="generateRig"
                      checked={generateRig}
                      onCheckedChange={setGenerateRig}
                      disabled={isExporting}
                      className="mt-0.5"
                    />
                    <Label htmlFor="generateRig" className="text-xs cursor-pointer leading-relaxed">
                      {t('io.export.generateRigLabel')}
                      <span className="block text-muted-foreground font-normal">
                        {t('io.export.generateRigDesc')}
                      </span>
                    </Label>
                  </div>
                )}
                {type === 'live2d_project' && generateRig && (
                  <>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="generatePhysics"
                        checked={generatePhysics}
                        onCheckedChange={setGeneratePhysics}
                        disabled={isExporting}
                        className="mt-0.5"
                      />
                      <Label htmlFor="generatePhysics" className="text-xs cursor-pointer leading-relaxed">
                        {t('io.export.generatePhysicsLabel')}
                        <span className="block text-muted-foreground font-normal">
                          {t('io.export.generatePhysicsDesc')}
                        </span>
                      </Label>
                    </div>
                    {generatePhysics && (
                      <div className="ml-6 space-y-1 border-l-2 border-muted pl-3">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="physicsHair"
                            checked={physicsHair}
                            onCheckedChange={setPhysicsHair}
                            disabled={isExporting}
                          />
                          <Label htmlFor="physicsHair" className="text-xs cursor-pointer">
                            {t('io.export.physicsHairLabel')} <span className="text-muted-foreground">{t('io.export.physicsHairHint')}</span>
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="physicsClothing"
                            checked={physicsClothing}
                            onCheckedChange={setPhysicsClothing}
                            disabled={isExporting}
                          />
                          <Label htmlFor="physicsClothing" className="text-xs cursor-pointer">
                            {t('io.export.physicsClothingLabel')}
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="physicsBust"
                            checked={physicsBust}
                            onCheckedChange={setPhysicsBust}
                            disabled={isExporting}
                          />
                          <Label htmlFor="physicsBust" className="text-xs cursor-pointer">
                            {t('io.export.physicsBustLabel')} <span className="text-muted-foreground">{t('io.export.physicsBustHint')}</span>
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="physicsArms"
                            checked={physicsArms}
                            onCheckedChange={setPhysicsArms}
                            disabled={isExporting}
                          />
                          <Label htmlFor="physicsArms" className="text-xs cursor-pointer">
                            {t('io.export.physicsArmsLabel')}
                          </Label>
                        </div>
                      </div>
                    )}

                    {/* Custom physics rules panel */}
                    {generatePhysics && (
                      <div className="ml-0">
                        <button
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPhysicsRules(v => !v)}
                        >
                          {showPhysicsRules ? '▾' : '▸'}
                          {project.physicsRules?.length > 0
                            ? <span>{t('io.export.customRulesLabel')} <span className="text-primary">{t('io.export.customRulesCount', { count: project.physicsRules.length })}</span></span>
                            : t('io.export.configureRules')}
                        </button>
                        {showPhysicsRules && (
                          <div className="mt-2 ml-1 border rounded p-2.5 bg-muted/10">
                            <PhysicsPanel />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                <div className="text-xs text-muted-foreground px-2 py-1.5 rounded bg-muted/50">
                  {type === 'live2d_project' ? (
                    <><span className="font-medium">Live2D Cubism .cmo3</span> — {t('io.export.cmo3Description')}</>
                  ) : (
                    <><span className="font-medium">Live2D Cubism V4.00</span> — {t('io.export.runtimeFormatDescription')}</>
                  )}
                </div>
                {/* Godot 无官方 Live2D 运行时，明确标注为实验性 */}
                <div className="text-[11px] text-amber-600 dark:text-amber-400 px-3 py-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-800/40">
                  {t('io.export.godotExperimentalNote')}
                </div>
              </div>
            </>
          )}

          {!isLive2D && <Separator />}

          {/* Sections 2-4: frame export options (hidden for Live2D) */}
          {!isLive2D && (<>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('io.export.labelAnimation')}</Label>
                <Select value={animTarget} onValueChange={setAnimTarget} disabled={isExporting}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staging">{t('io.export.animStaging')}</SelectItem>
                    {project.animations.length > 0 && <SelectItem value="current">{t('io.export.animCurrent')}</SelectItem>}
                    {project.animations.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {labelFor(a.name, lang)}
                      </SelectItem>
                    ))}
                    {project.animations.length > 1 && (
                      <SelectItem value="all">{t('io.export.animAll')}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {showFpsInput && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t('io.export.labelFps')}</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    value={exportFps}
                    min={1}
                    max={120}
                    onChange={e =>
                      setExportFps(Math.max(1, Number(e.target.value)))
                    }
                    disabled={isExporting}
                  />
                </div>
              )}

              {showFrameInput && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t('io.export.labelFrame')}</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[frameIndex]}
                      min={0}
                      max={maxFrameIndex}
                      step={1}
                      onValueChange={([v]) => setFrameIndex(v)}
                      disabled={isExporting || !hasFrames}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      className="h-8 text-xs w-20"
                      value={frameIndex}
                      min={0}
                      max={maxFrameIndex}
                      onChange={e =>
                        setFrameIndex(
                          Math.min(maxFrameIndex, Math.max(0, Number(e.target.value)))
                        )
                      }
                      disabled={isExporting || !hasFrames}
                    />
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {isSpine && (
              <div className="text-[11px] leading-relaxed text-muted-foreground bg-accent/20 p-3 rounded-md border border-accent/20 space-y-1.5">
                <p className="font-semibold text-foreground/90">{t('io.export.spineHowTo')}</p>
                <ol className="list-decimal list-inside space-y-1 ml-0.5">
                  <li>{t('io.export.spineStep1Prefix')} <strong>.zip</strong> {t('io.export.spineStep1Suffix')}</li>
                  <li>{t('io.export.spineStep2Prefix')} <strong>Spine menu &gt; Import Data...</strong></li>
                  <li>{t('io.export.spineStep3Prefix')} <strong>.json</strong> {t('io.export.spineStep3Suffix')}</li>
                </ol>
              </div>
            )}

            {/* Section 3: Image area, scale, BG */}
            {!isSpine && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t('io.export.labelImageContains')}
                  </Label>
                  <Select
                    value={imageContains}
                    onValueChange={setImageContains}
                    disabled={isExporting}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="canvas_area">{t('io.export.imageCanvasArea')}</SelectItem>
                      <SelectItem value="min_image_area">{t('io.export.imageMinArea')}</SelectItem>
                      <SelectItem value="custom">{t('io.export.imageCustom')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t('io.export.labelOutputScale')}
                  </Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    value={outputScale}
                    min={1}
                    max={400}
                    onChange={e =>
                      setOutputScale(Math.max(1, Number(e.target.value)))
                    }
                    disabled={isExporting}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t('io.export.labelBackground')}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={bgMode}
                      onValueChange={setBgMode}
                      disabled={isExporting}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="transparent">{t('io.export.bgTransparent')}</SelectItem>
                        <SelectItem value="custom">{t('io.export.bgCustomColor')}</SelectItem>
                      </SelectContent>
                    </Select>
                    {bgMode === 'custom' && (
                      <input
                        type="color"
                        value={bgColor}
                        className="h-8 w-10 rounded border border-input cursor-pointer p-0.5 bg-background"
                        onChange={e => setBgColor(e.target.value)}
                        disabled={isExporting}
                      />
                    )}
                  </div>
                </div>

                {showJpgWarning && (
                  <div className="text-xs text-yellow-600 dark:text-yellow-500 px-2 py-1 rounded bg-yellow-50 dark:bg-yellow-900/20">
                    {t('io.export.jpgWarning')}
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Section 4: Export destination */}
            {!isSpine && type !== 'single_frame' && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('io.export.labelExportTo')}</Label>
                <RadioGroup
                  value={exportDest}
                  onValueChange={setExportDest}
                  disabled={isExporting}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="zip" id="dest-zip" disabled={isExporting} />
                    <Label
                      htmlFor="dest-zip"
                      className="text-xs cursor-pointer"
                    >
                      {t('io.export.destZip')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem
                      value="folder"
                      id="dest-folder"
                      disabled={!hasFolderSupport || isExporting}
                    />
                    <Label
                      htmlFor="dest-folder"
                      className={cn(
                        'text-xs cursor-pointer',
                        (!hasFolderSupport || isExporting) &&
                        'opacity-40 cursor-not-allowed'
                      )}
                    >
                      {t('io.export.destFolder')}
                      {!hasFolderSupport && (
                        <span className="ml-1 text-muted-foreground">
                          {t('io.export.destNotSupported')}
                        </span>
                      )}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}
          </>)}

          {/* Error display */}
          {exportError && (
            <div className="text-xs text-red-600 dark:text-red-400 px-2 py-1.5 rounded bg-red-50 dark:bg-red-900/20">
              <span className="font-medium">{t('io.export.exportFailedLabel')}</span> {exportError}
            </div>
          )}

          {/* Progress bar */}
          {progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.label}</span>
                <span>
                  {progress.current}/{progress.total}
                </span>
              </div>
              <Progress
                value={Math.round((progress.current / progress.total) * 100)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isExporting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? t('io.export.exporting') : t('io.export.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

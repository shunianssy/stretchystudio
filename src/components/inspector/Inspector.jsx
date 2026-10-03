/**
 * Inspector panel — shown in the right sidebar.
 *
 * Sections:
 *  1. Overlay toggles: showImage, showWireframe, showVertices, showEdgeOutline
 *  2. Selected-node details: name, opacity, visibility (part or group)
 *  3. Transform panel: x, y, rotation, scale, pivot (part or group)
 *  4. Mesh settings: +V/-V buttons (only if mesh exists), collapsible sliders, Remesh button (part only)
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { computePoseOverrides } from '@/renderer/animationEngine';
import { beginBatch, endBatch } from '@/store/undoHistory';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HelpIcon } from '@/components/ui/help-icon';
import { WarpDeformerPanel } from '@/components/inspector/WarpDeformerPanel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

/* ── Small helpers ────────────────────────────────────────────────────────── */

function SectionTitle({ children }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
      {children}
    </p>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <Label className="text-xs text-muted-foreground shrink-0">{label}</Label>
      <div className="flex-1 flex items-center justify-end gap-2">{children}</div>
    </div>
  );
}



function SliderRow({ label, value, min, max, step = 1, onChange, help }) {
  const onPointerDown = () => {
    beginBatch(useProjectStore.getState().project);
  };
  const onPointerUp = () => {
    endBatch();
  };

  return (
    <div className="space-y-1 py-0.5" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="flex justify-between items-center gap-1">
        <div className="flex items-center gap-1">
          <Label className="text-xs text-muted-foreground">{label}</Label>
          {help && <HelpIcon tip={help} />}
        </div>
        <span className="text-xs tabular-nums text-foreground">{value}</span>
      </div>
      <Slider
        min={min} max={max} step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
    </div>
  );
}

/**
 * A numeric input that:
 * - Shows the current value
 * - Updates on blur or Enter
 * - Syncs externally when not focused
 */
function NumericInput({ value, onChange, step = 1, precision = 1, className = '' }) {
  const ref = useRef(null);

  // Keep the input in sync with external value changes (when not focused)
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.value = Number(value).toFixed(precision);
    }
  });

  const commit = () => {
    const v = parseFloat(ref.current.value);
    if (!isNaN(v)) onChange(v);
  };

  return (
    <input
      ref={ref}
      type="number"
      step={step}
      defaultValue={Number(value).toFixed(precision)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={`w-16 text-xs bg-input text-foreground border border-border rounded px-1.5 py-0.5 text-right
        [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
        focus:outline-none focus:ring-1 focus:ring-primary/50 ${className}`}
    />
  );
}

/* ── Node details (part or group) ─────────────────────────────────────────── */

function NodeDetails({ node }) {
  const { t } = useTranslation(); // 组件内订阅语言
  const updateProject = useProjectStore(s => s.updateProject);

  const setOpacity = useCallback((v) => {
    if (useEditorStore.getState().editorMode === 'animation') {
      useAnimationStore.getState().setDraftPose(node.id, { opacity: v });
      if (useEditorStore.getState().autoKeyframe) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    } else {
      updateProject((proj) => {
        const n = proj.nodes.find(x => x.id === node.id);
        if (n) n.opacity = v;
      });
    }
  }, [node.id, updateProject]);

  const setVisible = useCallback((checked) => {
    if (useEditorStore.getState().editorMode === 'animation') {
      useAnimationStore.getState().setDraftPose(node.id, { visible: checked });
      if (useEditorStore.getState().autoKeyframe) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    } else {
      updateProject((proj) => {
        const n = proj.nodes.find(x => x.id === node.id);
        if (n) n.visible = checked;
      });
    }
  }, [node.id, updateProject]);

  return (
    <div className="space-y-1">
      <SectionTitle>{node.type === 'group' ? t('panels.inspector.group') : t('panels.inspector.part')}</SectionTitle>
      <Row label={t('common.name')}>
        <span className="text-xs font-mono truncate max-w-[100px] text-right" title={node.name}>
          {node.name || node.id}
        </span>
      </Row>
      <Row label={t('panels.inspector.visible')}>
        <Switch
          checked={node.visible !== false}
          onCheckedChange={setVisible}
          className="scale-75 origin-right"
        />
      </Row>
      <SliderRow
        label={t('common.opacity')}
        value={Math.round((node.opacity ?? 1) * 100)}
        min={0} max={100}
        onChange={(v) => setOpacity(v / 100)}
      />
    </div>
  );
}

/* ── Transform panel ──────────────────────────────────────────────────────── */

function TransformPanel({ node, allNodes }) {
  const { t } = useTranslation(); // 组件内订阅语言
  const updateProject = useProjectStore(s => s.updateProject);

  const setTransformField = useCallback((field, value) => {
    if (useEditorStore.getState().editorMode === 'animation') {
      useAnimationStore.getState().setDraftPose(node.id, { [field]: value });
      if (useEditorStore.getState().autoKeyframe) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    } else {
      updateProject((proj) => {
        const n = proj.nodes.find(x => x.id === node.id);
        if (!n) return;
        if (!n.transform) n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
        n.transform[field] = value;
      });
    }
  }, [node.id, updateProject]);

  const tf = node.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };

  return (
    <div className="space-y-1.5">
      <SectionTitle>{t('panels.inspector.transform')}</SectionTitle>

      {/* Position */}
      <div className="flex items-center gap-1 py-0.5">
        <Label className="text-xs text-muted-foreground w-8 shrink-0">{t('panels.inspector.pos')}</Label>
        <div className="flex gap-1 flex-1 justify-end">
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">X</span>
            <NumericInput value={tf.x ?? 0} onChange={v => setTransformField('x', v)} step={1} precision={1} />
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">Y</span>
            <NumericInput value={tf.y ?? 0} onChange={v => setTransformField('y', v)} step={1} precision={1} />
          </div>
        </div>
      </div>

      {/* Rotation */}
      <Row label={t('panels.inspector.rotation')}>
        <NumericInput value={tf.rotation ?? 0} onChange={v => setTransformField('rotation', v)} step={0.5} precision={1} />
      </Row>


      {/* Scale */}
      <div className="flex items-center gap-1 py-0.5">
        <Label className="text-xs text-muted-foreground w-8 shrink-0">{t('common.scale')}</Label>
        <div className="flex gap-1 flex-1 justify-end">
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">X</span>
            <NumericInput value={tf.scaleX ?? 1} onChange={v => setTransformField('scaleX', v)} step={0.05} precision={2} />
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">Y</span>
            <NumericInput value={tf.scaleY ?? 1} onChange={v => setTransformField('scaleY', v)} step={0.05} precision={2} />
          </div>
        </div>
      </div>

      {/* Pivot */}
      <div className="flex items-center gap-1 py-0.5">
        <Label className="text-xs text-muted-foreground w-8 shrink-0">{t('panels.inspector.pivot')}</Label>
        <div className="flex gap-1 flex-1 justify-end">
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">X</span>
            <NumericInput value={tf.pivotX ?? 0} onChange={v => setTransformField('pivotX', v)} step={1} precision={1} />
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">Y</span>
            <NumericInput value={tf.pivotY ?? 0} onChange={v => setTransformField('pivotY', v)} step={1} precision={1} />
          </div>
        </div>
      </div>

      {/* Reset button */}
      <Button
        size="sm"
        variant="outline"
        className="w-full h-6 text-[10px] mt-1"
        onClick={() => updateProject((proj) => {
          const n = proj.nodes.find(x => x.id === node.id);
          if (n) n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
        })}
      >
        {t('panels.inspector.resetTransform')}
      </Button>
      
      {/* Limb skinning warning */}
      {(() => {
        const JSKinningRoles = new Set(['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']);
        if (!JSKinningRoles.has(node.boneRole)) return null;
        const hasDependent = allNodes.some(n => n.type === 'part' && n.mesh?.jointBoneId === node.id);
        if (hasDependent) return null;
        return (
          <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs leading-relaxed text-amber-500">
            <span className="font-bold">{t('panels.inspector.limbMeshRequiredBold')}</span> {t('panels.inspector.limbMeshRequiredRest')}
          </div>
        );
      })()}
    </div>
  );
}

/* ── Texture Panel ────────────────────────────────────────────────────────── */

function TexturePanel({ node }) {
  const { t } = useTranslation(); // 组件内订阅语言
  const updateProject = useProjectStore(s => s.updateProject);
  const textures = useProjectStore(s => s.project.textures);
  const fileInputRef = useRef(null);

  if (!node || node.type !== 'part') return null;

  const handleExport = () => {
    const tex = textures.find(t => t.id === node.id);
    if (!tex) {
      console.warn('No texture found for node', node.id);
      return;
    }
    
    const link = document.createElement('a');
    link.href = tex.source;
    link.download = `${node.name || node.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const source = event.target.result;
      const img = new Image();
      img.onload = () => {
        updateProject((proj, ver) => {
          // Update texture entry
          const texIdx = proj.textures.findIndex(t => t.id === node.id);
          if (texIdx !== -1) {
            proj.textures[texIdx].source = source;
          } else {
            proj.textures.push({ id: node.id, source });
          }

          // Update node dimensions
          const n = proj.nodes.find(x => x.id === node.id);
          if (n) {
            n.imageWidth = img.width;
            n.imageHeight = img.height;
          }
          
          ver.textureVersion++;
        });
      };
      img.src = source;
    };
    reader.readAsDataURL(file);
    
    // Reset input so searching for the same file works again
    e.target.value = '';
  };

  return (
    <div className="space-y-2">
      <SectionTitle>{t('panels.inspector.texture')}</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Button 
          size="sm" 
          variant="outline" 
          className="h-7 text-xs"
          onClick={handleExport}
        >
          {t('panels.inspector.exportTexture')}
        </Button>
        <Button 
          size="sm" 
          variant="outline" 
          className="h-7 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          {t('panels.inspector.replaceTexture')}
        </Button>
      </div>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={onFileChange}
      />
      {node.mesh && (
        <p className="text-[10px] text-muted-foreground leading-tight italic">
          {t('panels.inspector.textureTip')}
        </p>
      )}
    </div>
  );
}

/* ── Mesh settings ────────────────────────────────────────────────────────── */

function MeshPanel({ node, onRemesh, onDeleteMesh }) {
  const { t } = useTranslation(); // 组件内订阅语言
  const [expanded, setExpanded] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const meshDefaults = useEditorStore(s => s.meshDefaults);
  const setMeshDefaults = useEditorStore(s => s.setMeshDefaults);
  const meshEditMode = useEditorStore(s => s.meshEditMode);
  const setMeshEditMode = useEditorStore(s => s.setMeshEditMode);
  const meshSubMode = useEditorStore(s => s.meshSubMode);
  const setMeshSubMode = useEditorStore(s => s.setMeshSubMode);
  const toolMode = useEditorStore(s => s.toolMode);
  const setToolMode = useEditorStore(s => s.setToolMode);
  const brushSize = useEditorStore(s => s.brushSize);
  const brushHardness = useEditorStore(s => s.brushHardness);
  const setBrush = useEditorStore(s => s.setBrush);
  const updateProject = useProjectStore(s => s.updateProject);

  const handleDeleteMesh = () => {
    onDeleteMesh(node.id);
    setConfirmDelete(false);
  };

  const opts = node.meshOpts ?? meshDefaults;

  const setOpt = useCallback((key, value) => {
    if (node.meshOpts) {
      updateProject((proj) => {
        const n = proj.nodes.find(x => x.id === node.id);
        if (n?.meshOpts) n.meshOpts[key] = value;
      });
    } else {
      setMeshDefaults({ [key]: value });
    }
  }, [node.id, node.meshOpts, updateProject, setMeshDefaults]);

  const enablePerPart = useCallback(() => {
    updateProject((proj) => {
      const n = proj.nodes.find(x => x.id === node.id);
      if (n) n.meshOpts = { ...meshDefaults };
    });
  }, [node.id, meshDefaults, updateProject]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>{t('panels.inspector.mesh')}</SectionTitle>
        <div className="flex items-center gap-1">
          {node.mesh && (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-[10px]"
              onClick={() => setConfirmDelete(true)}
            >
              {t('panels.inspector.deleteMesh')}
            </Button>
          )}
          {!node.mesh && !node.meshOpts && (
            <button
              onClick={enablePerPart}
              className="text-[10px] text-primary underline-offset-2 hover:underline"
            >
              {t('panels.inspector.override')}
            </button>
          )}
        </div>
      </div>

      {/* Mesh info + Edit Mode toggle */}
      {node.mesh && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Row label={t('panels.inspector.vertices')}>
              <span className="text-xs tabular-nums">{node.mesh?.vertices?.length ?? '—'}</span>
            </Row>
            <Row label={t('panels.inspector.triangles')}>
              <span className="text-xs tabular-nums">{node.mesh?.triangles?.length ?? '—'}</span>
            </Row>
          </div>
          <Button
            size="sm"
            variant={meshEditMode ? 'default' : 'outline'}
            className="w-full h-7 text-xs"
            onClick={() => setMeshEditMode(!meshEditMode)}
          >
            {meshEditMode ? t('panels.inspector.exitEditMode') : t('panels.inspector.editMesh')}
          </Button>
          {meshEditMode && (
            <div className="space-y-1.5">
              <div className="flex rounded overflow-hidden border border-border text-xs">
                <button
                  className={`flex-1 py-1 ${meshSubMode === 'deform' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setMeshSubMode('deform')}
                >
                  {t('panels.inspector.deform')}
                </button>
                <button
                  className={`flex-1 py-1 border-l border-border ${meshSubMode === 'adjust' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setMeshSubMode('adjust')}
                >
                  {t('panels.inspector.adjust')}
                </button>
              </div>
              {meshSubMode === 'deform' && (
                <div className="space-y-2 pt-0.5">
                  <SliderRow
                    label={t('panels.inspector.brushSize')}
                    value={brushSize}
                    min={5} max={300} step={1}
                    onChange={(v) => setBrush({ brushSize: v })}
                  />
                  <SliderRow
                    label={t('panels.inspector.hardness')}
                    value={Math.round(brushHardness * 100)}
                    min={0} max={100} step={1}
                    onChange={(v) => setBrush({ brushHardness: v / 100 })}
                  />
                </div>
              )}
              {meshSubMode === 'adjust' && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={toolMode === 'add_vertex' ? 'default' : 'outline'}
                    className="flex-1 h-7 text-xs"
                    onClick={() => setToolMode(toolMode === 'add_vertex' ? 'select' : 'add_vertex')}
                  >
                    {t('panels.inspector.addVertex')}
                  </Button>
                  <Button
                    size="sm"
                    variant={toolMode === 'remove_vertex' ? 'destructive' : 'outline'}
                    className="flex-1 h-7 text-xs"
                    onClick={() => setToolMode(toolMode === 'remove_vertex' ? 'select' : 'remove_vertex')}
                  >
                    {t('panels.inspector.removeVertex')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!node.mesh && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t('panels.inspector.noMesh')}
        </p>
      )}

      {/* Skin weight warning — shown when mesh exists but has no bone weights */}
      {node.mesh && !node.mesh.jointBoneId && (() => {
        // Only show if this part's parent is a limb bone
        const LIMB_ROLES = new Set(['leftArm', 'rightArm', 'leftLeg', 'rightLeg']);
        const allNodes = useProjectStore.getState().project.nodes;
        const parentNode = allNodes.find(n => n.id === node.parent);
        if (!parentNode || !LIMB_ROLES.has(parentNode.boneRole)) return null;
        return (
          <p className="text-xs leading-relaxed rounded px-2 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400">
            {t('panels.inspector.meshBeforeRiggingPre')}<strong>{t('panels.inspector.remesh')}</strong>{t('panels.inspector.meshBeforeRiggingPost')}
          </p>
        );
      })()}

      {/* Collapsible sliders section */}
      <div className="space-y-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-0.5"
        >
          <span>{expanded ? '▼' : '▶'}</span>
          <span className="font-medium">{t('panels.inspector.settings')}</span>
        </button>
        {expanded && (
          <div className="space-y-2 pl-2 border-l border-border/50">
            <SliderRow
              label={t('panels.inspector.alphaThreshold')}
              value={opts.alphaThreshold}
              min={1} max={254}
              onChange={(v) => setOpt('alphaThreshold', v)}
              help={t('panels.inspector.alphaThresholdHelp')}
            />
            <SliderRow
              label={t('panels.inspector.smoothPasses')}
              value={opts.smoothPasses}
              min={0} max={10}
              onChange={(v) => setOpt('smoothPasses', v)}
              help={t('panels.inspector.smoothPassesHelp')}
            />
            <SliderRow
              label={t('panels.inspector.gridSpacing')}
              value={opts.gridSpacing}
              min={6} max={100}
              onChange={(v) => setOpt('gridSpacing', v)}
              help={t('panels.inspector.gridSpacingHelp')}
            />
            <SliderRow
              label={t('panels.inspector.edgePadding')}
              value={opts.edgePadding}
              min={0} max={40}
              onChange={(v) => setOpt('edgePadding', v)}
              help={t('panels.inspector.edgePaddingHelp')}
            />
            <SliderRow
              label={t('panels.inspector.edgePoints')}
              value={opts.numEdgePoints}
              min={8} max={300}
              onChange={(v) => setOpt('numEdgePoints', v)}
              help={t('panels.inspector.edgePointsHelp')}
            />
          </div>
        )}
      </div>

      <Button
        size="sm"
        className="w-full h-7 text-xs mt-1"
        onClick={() => onRemesh(node.id, opts)}
      >
        {node.mesh ? t('panels.inspector.remesh') : t('panels.inspector.generateMesh')}
      </Button>

      {/* Delete mesh confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle>{t('panels.inspector.confirmDeleteMeshTitle')}</DialogTitle>
          <DialogDescription>
            {t('panels.inspector.confirmDeleteMeshDesc', { name: node.name || node.id })}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDeleteMesh}>
              {t('panels.inspector.deleteMesh')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Shape Keys Panel ─────────────────────────────────────────────────────── */

function ShapeKeysPanel({ node }) {
  const { t } = useTranslation(); // 组件内订阅语言
  const updateProject = useProjectStore(s => s.updateProject);
  const createBlendShape = useProjectStore(s => s.createBlendShape);
  const deleteBlendShape = useProjectStore(s => s.deleteBlendShape);
  const setBlendShapeValue = useProjectStore(s => s.setBlendShapeValue);
  const setDraftPose = useAnimationStore(s => s.setDraftPose);
  const editorMode = useEditorStore(s => s.editorMode);
  const blendShapeEditMode = useEditorStore(s => s.blendShapeEditMode);
  const activeBlendShapeId = useEditorStore(s => s.activeBlendShapeId);
  const enterBlendShapeEditMode = useEditorStore(s => s.enterBlendShapeEditMode);
  const exitBlendShapeEditMode = useEditorStore(s => s.exitBlendShapeEditMode);
  const autoKeyframe = useEditorStore(s => s.autoKeyframe);
  const currentTime = useAnimationStore(s => s.currentTime);
  const activeAnimationId = useAnimationStore(s => s.activeAnimationId);

  if (!node?.blendShapes) return null;

  const shapes = node.blendShapes;

  const handleAddShape = () => {
    const nextNum = shapes.length + 1;
    createBlendShape(node.id, `Key ${nextNum}`);
  };

  const handleDeleteShape = (shapeId) => {
    deleteBlendShape(node.id, shapeId);
    if (activeBlendShapeId === shapeId) {
      exitBlendShapeEditMode();
    }
  };

  const handleRenameShape = (shapeId, newName) => {
    updateProject((proj) => {
      const n = proj.nodes.find(nd => nd.id === node.id);
      const shape = n?.blendShapes?.find(s => s.id === shapeId);
      if (shape) shape.name = newName;
    });
  };

  const handleInfluenceChange = (shapeId, value) => {
    if (editorMode === 'animation') {
      const prop = `blendShape:${shapeId}`;
      setDraftPose(node.id, { [prop]: value });
      if (autoKeyframe) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K' }));
      }
    } else {
      setBlendShapeValue(node.id, shapeId, value);
    }
  };

  const handleEnterEditMode = (shapeId) => {
    enterBlendShapeEditMode(shapeId);
  };

  const handleExitEditMode = () => {
    exitBlendShapeEditMode();
  };

  // In edit mode, show condensed header instead of full list
  if (blendShapeEditMode && activeBlendShapeId) {
    const editingShape = shapes.find(s => s.id === activeBlendShapeId);
    return (
      <div className="space-y-2">
        <SectionTitle>{t('panels.inspector.shapeKeys')}</SectionTitle>
        <div className="flex items-center justify-between rounded bg-primary/10 border border-primary/30 px-2 py-1.5 gap-2">
          <span className="text-xs text-primary font-medium">
            {t('panels.inspector.editing', { name: editingShape?.name ?? '...' })}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] shrink-0"
            onClick={handleExitEditMode}
          >
            {t('common.done')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>{t('panels.inspector.shapeKeys')}</SectionTitle>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-sm shrink-0"
          onClick={handleAddShape}
          title={t('panels.inspector.addShapeKey')}
        >
          +
        </Button>
      </div>

      {/* Basis row — always at top, read-only */}
      <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
        <span className="flex-1">{t('panels.inspector.basis')}</span>
        <span className="w-14"></span>
      </div>

      {/* Shape key rows */}
      {shapes.map(shape => {
        const influence = node.blendShapeValues?.[shape.id] ?? 0;
        return (
          <div
            key={shape.id}
            className={`flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors ${
              activeBlendShapeId === shape.id ? 'bg-primary/10' : ''
            }`}
          >
            {/* Editable name field */}
            <input
              className="flex-1 text-xs bg-transparent min-w-0 border-0 outline-none px-1"
              value={shape.name}
              onChange={e => handleRenameShape(shape.id, e.target.value)}
              style={{ color: 'inherit' }}
            />

            {/* Influence slider */}
            <div className="w-16">
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={[influence]}
                onValueChange={([v]) => handleInfluenceChange(shape.id, v)}
                className="w-full"
              />
            </div>

            {/* Value label */}
            <span className="text-[10px] tabular-nums w-6 text-right text-muted-foreground">
              {influence.toFixed(2)}
            </span>

            {/* Edit pencil button */}
            <button
              className="text-muted-foreground hover:text-primary transition-colors p-0.5 shrink-0"
              onClick={() => handleEnterEditMode(shape.id)}
              title={t('panels.inspector.editShape')}
            >
              ✎
            </button>

            {/* Delete button */}
            <button
              className="text-muted-foreground hover:text-destructive transition-colors p-0.5 shrink-0"
              onClick={() => handleDeleteShape(shape.id)}
              title={t('panels.inspector.deleteShape')}
            >
              ×
            </button>
          </div>
        );
      })}

      {shapes.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          {t('panels.inspector.noShapeKeys')}
        </p>
      )}
    </div>
  );
}

/* ── Root Inspector ───────────────────────────────────────────────────────── */

export function Inspector({ onRemesh, onDeleteMesh }) {
  const { t } = useTranslation(); // 组件顶层订阅语言
  const selection = useEditorStore(s => s.selection);
  const editorMode = useEditorStore(s => s.editorMode);
  const nodes = useProjectStore(s => s.project.nodes);
  const animations = useProjectStore(s => s.project.animations);
  
  const activeAnimationId = useAnimationStore(s => s.activeAnimationId);
  const currentTime = useAnimationStore(s => s.currentTime);
  const draftPose = useAnimationStore(s => s.draftPose);
  const loopKeyframes = useAnimationStore(s => s.loopKeyframes);
  const fps = useAnimationStore(s => s.fps);
  const endFrame = useAnimationStore(s => s.endFrame);

  const effectiveNode = React.useMemo(() => {
    const baseNode = nodes.find(n => n.id === selection[0]);
    if (!baseNode) return null;
    if (editorMode !== 'animation') return baseNode;

    const activeAnim = animations.find(a => a.id === activeAnimationId) ?? null;
    const endMs = (endFrame / fps) * 1000;
    const overrides = computePoseOverrides(activeAnim, currentTime, loopKeyframes, endMs);
    
    const kfOv = overrides.get(baseNode.id);
    const drOv = draftPose.get(baseNode.id);
    if (!kfOv && !drOv) return baseNode;

    const tr = { ...baseNode.transform };
    const ANIM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
    if (kfOv) { for (const k of ANIM_KEYS) { if (kfOv[k] !== undefined) tr[k] = kfOv[k]; } }
    if (drOv) { for (const k of ANIM_KEYS) { if (drOv[k] !== undefined) tr[k] = drOv[k]; } }

    // Propagate blend shape influences from keyframe/draft overrides
    const effectiveBSV = { ...(baseNode.blendShapeValues ?? {}) };
    for (const shape of (baseNode.blendShapes ?? [])) {
      const prop = `blendShape:${shape.id}`;
      effectiveBSV[shape.id] = drOv?.[prop] ?? kfOv?.[prop] ?? effectiveBSV[shape.id] ?? 0;
    }

    return {
      ...baseNode,
      transform: tr,
      opacity: drOv?.opacity ?? kfOv?.opacity ?? baseNode.opacity,
      visible: drOv?.visible ?? kfOv?.visible ?? baseNode.visible,
      blendShapeValues: effectiveBSV,
    };
  }, [selection, nodes, editorMode, animations, activeAnimationId, currentTime, draftPose, loopKeyframes, fps, endFrame]);

  return (
    <div className="flex flex-col gap-4 p-3 h-full overflow-y-auto">
      {effectiveNode ? (
        <>
          <NodeDetails node={effectiveNode} />
          <Separator />
          <TransformPanel node={effectiveNode} allNodes={nodes} />
          {effectiveNode.type === 'part' && (
            <>
              <Separator />
              <TexturePanel node={effectiveNode} />
              <Separator />
              <MeshPanel node={effectiveNode} onRemesh={onRemesh} onDeleteMesh={onDeleteMesh} />
              {effectiveNode.mesh && (
                <>
                  <Separator />
                  <ShapeKeysPanel node={effectiveNode} />
                </>
              )}
            </>
          )}
          {effectiveNode.type === 'warpDeformer' && (
            <>
              <Separator />
              <WarpDeformerPanel node={effectiveNode} />
            </>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground text-center mt-4">
          {t('panels.inspector.selectLayer')}
        </p>
      )}
    </div>
  );
}

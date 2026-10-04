import React from 'react';
import { useProjectStore } from '@/store/projectStore';
import { PHYSICS_RULES } from '@/io/live2d/cmo3/physics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight, Trash2, Plus, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { labelFor } from '@/i18n/labels';

/** 类别 -> i18n 键 的映射表（模块级常量，渲染时再调用 t()） */
const CATEGORY_LABEL_KEYS = {
  hair:     'io.physics.categoryHair',
  clothing: 'io.physics.categoryClothing',
  bust:     'io.physics.categoryBust',
  arms:     'io.physics.categoryArms',
};

/**
 * PhysicsPanel — displays and edits project.physicsRules[].
 * When rules is empty the exporter falls back to PHYSICS_RULES defaults,
 * so this panel only modifies behavior once the user explicitly loads or
 * customises rules.
 */
export function PhysicsPanel() {
  const { t, lang } = useTranslation();
  const physicsRules    = useProjectStore(s => s.project.physicsRules);
  const setPhysicsRules = useProjectStore(s => s.setPhysicsRules);
  const createPhysicsRule = useProjectStore(s => s.createPhysicsRule);
  const updatePhysicsRule = useProjectStore(s => s.updatePhysicsRule);
  const deletePhysicsRule = useProjectStore(s => s.deletePhysicsRule);

  const [expanded, setExpanded] = React.useState({});

  const isEmpty = !physicsRules || physicsRules.length === 0;

  const handleLoadDefaults = () => {
    setPhysicsRules(PHYSICS_RULES.map(r => ({ ...r, enabled: true })));
  };

  const handleReset = () => {
    setPhysicsRules([]);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={handleLoadDefaults}
          title={t('io.physics.loadDefaultsHint')}
        >
          <RotateCcw className="h-3 w-3" /> {t('io.physics.loadDefaults')}
        </Button>

        {!isEmpty && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive gap-1.5"
            onClick={handleReset}
            title={t('io.physics.clearAllHint')}
          >
            {t('io.physics.clearAll')}
          </Button>
        )}
      </div>

      {isEmpty ? (
        <p className="text-xs text-muted-foreground italic">
          {t('io.physics.empty', { count: PHYSICS_RULES.length })}
        </p>
      ) : (
        <div className="space-y-1 border rounded overflow-hidden">
          {physicsRules.map((rule, idx) => {
            const isExpanded = !!expanded[rule.id];
            const isEnabled  = rule.enabled !== false;

            return (
              <div key={rule.id} className="border-b last:border-b-0">
                {/* Rule header row */}
                <div className="flex items-center gap-2 px-2 py-1.5 group bg-card hover:bg-muted/30">
                  <Checkbox
                    checked={isEnabled}
                    onCheckedChange={v => updatePhysicsRule(rule.id, { enabled: !!v })}
                    className="shrink-0"
                  />

                  <button
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => setExpanded(e => ({ ...e, [rule.id]: !e[rule.id] }))}
                  >
                    {isExpanded
                      ? <ChevronDown  className="h-3 w-3" />
                      : <ChevronRight className="h-3 w-3" />}
                  </button>

                  <span className={`text-xs flex-1 font-medium ${!isEnabled ? 'line-through text-muted-foreground' : ''}`}>
                    {labelFor(rule.name, lang)}
                  </span>

                  <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded shrink-0">
                    {CATEGORY_LABEL_KEYS[rule.category] ? t(CATEGORY_LABEL_KEYS[rule.category]) : rule.category}
                  </span>

                  <button
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => deletePhysicsRule(rule.id)}
                    title={t('io.physics.deleteRule')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {/* Expanded: pendulum vertex editor */}
                {isExpanded && (
                  <div className="px-3 py-2.5 space-y-3 bg-muted/10 border-t">
                    {/* Name & category */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-0.5">
                        <Label className="text-[10px] text-muted-foreground">{t('io.physics.name')}</Label>
                        <Input
                          className="h-6 text-xs"
                          value={rule.name}
                          onChange={e => updatePhysicsRule(rule.id, { name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[10px] text-muted-foreground">{t('io.physics.category')}</Label>
                        <select
                          className="w-full h-6 text-xs px-1 rounded border bg-background"
                          value={rule.category ?? ''}
                          onChange={e => updatePhysicsRule(rule.id, { category: e.target.value })}
                        >
                          <option value="hair">{t('io.physics.categoryHair')}</option>
                          <option value="clothing">{t('io.physics.categoryClothing')}</option>
                          <option value="bust">{t('io.physics.categoryBust')}</option>
                          <option value="arms">{t('io.physics.categoryArms')}</option>
                        </select>
                      </div>
                    </div>

                    {/* Require tag */}
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-muted-foreground">
                        {t('io.physics.requireTag')}
                      </Label>
                      <Input
                        className="h-6 text-xs font-mono"
                        placeholder={t('io.physics.requireTagPlaceholder')}
                        value={rule.requireTag ?? ''}
                        onChange={e => updatePhysicsRule(rule.id, { requireTag: e.target.value || null })}
                      />
                    </div>

                    {/* Pendulum vertices */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">
                        {t('io.physics.pendulumVertices')}
                      </Label>
                      {(rule.vertices ?? []).map((v, vi) => (
                        <div key={vi} className="grid grid-cols-5 gap-1 items-center">
                          <span className="text-[10px] text-muted-foreground col-span-1">#{vi}</span>
                          <div className="col-span-4 grid grid-cols-4 gap-1">
                            <div>
                              <Label className="text-[9px] text-muted-foreground">{t('io.physics.vertexY')}</Label>
                              <Input
                                type="number"
                                className="h-5 text-xs px-1"
                                value={v.y}
                                step="1"
                                onChange={e => {
                                  const verts = rule.vertices.map((vv, i) =>
                                    i === vi ? { ...vv, y: Number(e.target.value) } : vv
                                  );
                                  updatePhysicsRule(rule.id, { vertices: verts });
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-[9px] text-muted-foreground">{t('io.physics.mobility')}</Label>
                              <Input
                                type="number"
                                className="h-5 text-xs px-1"
                                value={v.mobility}
                                step="0.05"
                                min="0" max="1"
                                onChange={e => {
                                  const verts = rule.vertices.map((vv, i) =>
                                    i === vi ? { ...vv, mobility: Number(e.target.value) } : vv
                                  );
                                  updatePhysicsRule(rule.id, { vertices: verts });
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-[9px] text-muted-foreground">{t('io.physics.delay')}</Label>
                              <Input
                                type="number"
                                className="h-5 text-xs px-1"
                                value={v.delay}
                                step="0.05"
                                min="0" max="1"
                                onChange={e => {
                                  const verts = rule.vertices.map((vv, i) =>
                                    i === vi ? { ...vv, delay: Number(e.target.value) } : vv
                                  );
                                  updatePhysicsRule(rule.id, { vertices: verts });
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-[9px] text-muted-foreground">{t('io.physics.accel')}</Label>
                              <Input
                                type="number"
                                className="h-5 text-xs px-1"
                                value={v.acceleration}
                                step="0.1"
                                min="0.5" max="5"
                                onChange={e => {
                                  const verts = rule.vertices.map((vv, i) =>
                                    i === vi ? { ...vv, acceleration: Number(e.target.value) } : vv
                                  );
                                  updatePhysicsRule(rule.id, { vertices: verts });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Output param & scale */}
                    {rule.outputParamId !== undefined && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <Label className="text-[10px] text-muted-foreground">{t('io.physics.outputParamId')}</Label>
                          <Input
                            className="h-6 text-xs font-mono"
                            value={rule.outputParamId ?? ''}
                            onChange={e => updatePhysicsRule(rule.id, { outputParamId: e.target.value })}
                          />
                        </div>
                        <div className="space-y-0.5">
                          <Label className="text-[10px] text-muted-foreground">{t('io.physics.outputScale')}</Label>
                          <Input
                            type="number"
                            className="h-6 text-xs"
                            value={rule.outputScale ?? 1}
                            step="0.1"
                            onChange={e => updatePhysicsRule(rule.id, { outputScale: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

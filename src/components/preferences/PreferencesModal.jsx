import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sun, Moon, Monitor, Palette, Info, Settings2, Layout } from 'lucide-react';
import { useTheme, AVAILABLE_FONTS } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';
import { useTranslation } from '@/i18n';

export function PreferencesModal({ open, onOpenChange }) {
  const { t } = useTranslation();
  const {
    themeMode, setThemeMode,
    openThemeModal,
    setLightTheme, setDarkTheme,
    fontFamily, setFontFamily,
    fontSize, setFontSize,
  } = useTheme();

  const handleThemeSelectClick = () => {
    const config = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? {
      title: t('io.preferences.selectDarkTheme'),
      themes: darkThemePresets,
      onSelect: setDarkTheme,
    } : {
      title: t('io.preferences.selectLightTheme'),
      themes: lightThemePresets,
      onSelect: setLightTheme,
    };
    openThemeModal(config);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden outline-none border-none shadow-lg">
        <div className="flex flex-col h-[500px]">
          <DialogHeader className="p-6 pb-2 border-b">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Settings2 className="w-5 h-5 text-primary" />
              {t('io.preferences.title')}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="interface" className="flex flex-1 overflow-hidden">
            <TabsList className="flex flex-col h-full w-48 rounded-none border-r bg-muted/30 p-2 gap-1 items-stretch justify-start">
              <TabsTrigger
                value="general"
                className="justify-start gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Settings2 className="w-4 h-4" />
                {t('io.preferences.tabGeneral')}
              </TabsTrigger>
              <TabsTrigger
                value="interface"
                className="justify-start gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Layout className="w-4 h-4" />
                {t('io.preferences.tabInterface')}
              </TabsTrigger>
              <TabsTrigger
                value="about"
                className="justify-start gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Info className="w-4 h-4" />
                {t('io.preferences.tabAbout')}
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto p-6 bg-background">
              <TabsContent value="general" className="mt-0 space-y-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-medium">{t('io.preferences.generalSettings')}</h3>
                  <p className="text-sm text-muted-foreground">{t('io.preferences.nothingHere')}</p>
                </div>
              </TabsContent>

              <TabsContent value="interface" className="mt-0 space-y-8">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-medium">{t('io.preferences.appearance')}</h3>
                    <p className="text-sm text-muted-foreground">{t('io.preferences.appearanceDesc')}</p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">{t('io.preferences.themeMode')}</Label>
                    <div className="flex items-center gap-4">
                      <ToggleGroup
                        type="single"
                        value={themeMode}
                        onValueChange={(value) => {
                          if (value) setThemeMode(value);
                        }}
                        aria-label={t('io.preferences.themeMode')}
                        className="bg-muted p-1 rounded-md"
                      >
                        <ToggleGroupItem value="light" aria-label={t('io.preferences.lightMode')} className="gap-2 px-3">
                          <Sun className="h-4 w-4" />
                          <span className="text-xs">{t('io.preferences.light')}</span>
                        </ToggleGroupItem>
                        <ToggleGroupItem value="dark" aria-label={t('io.preferences.darkMode')} className="gap-2 px-3">
                          <Moon className="h-4 w-4" />
                          <span className="text-xs">{t('io.preferences.dark')}</span>
                        </ToggleGroupItem>
                        <ToggleGroupItem value="system" aria-label={t('io.preferences.systemMode')} className="gap-2 px-3">
                          <Monitor className="h-4 w-4" />
                          <span className="text-xs">{t('io.preferences.system')}</span>
                        </ToggleGroupItem>
                      </ToggleGroup>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleThemeSelectClick}
                        className="gap-2"
                      >
                        <Palette className="h-4 w-4" />
                        {t('io.preferences.colorPreset')}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="font-select" className="text-sm font-semibold">{t('io.preferences.fontFamily')}</Label>
                      <Select value={fontFamily} onValueChange={setFontFamily}>
                        <SelectTrigger id="font-select" className="h-9">
                          <SelectValue placeholder={t('io.preferences.selectFont')} />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_FONTS.map((font) => (
                            <SelectItem key={font.id} value={font.id}>
                              {font.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="font-size-slider" className="text-sm font-semibold">{t('io.preferences.fontSize', { size: fontSize })}</Label>
                      <div className="pt-2">
                        <Slider
                          id="font-size-slider"
                          min={12}
                          max={20}
                          step={1}
                          value={[fontSize]}
                          onValueChange={(value) => setFontSize(value[0])}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="about" className="mt-0 space-y-6">
                <div className="space-y-2 text-center py-4">
                  <h2 className="text-2xl font-bold tracking-tight">Plianca Studio</h2>
                  <p className="text-sm text-muted-foreground font-mono">{t('io.preferences.version', { version: '0.2' })}</p>
                  <p className="max-w-sm mx-auto text-sm text-balance text-muted-foreground">
                    {t('io.preferences.aboutDesc')}
                  </p>
                </div>

                <div className="border-t pt-6 bg-muted/30 -mx-6 px-6 pb-6">
                  <h4 className="text-sm font-semibold mb-2">
                    {t('io.preferences.ecosystem')}
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                    {t('io.preferences.ecosystemDescPrefix')}
                    <a href="https://github.com/shitagaki-lab/see-through" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium ml-1">
                      See-through
                    </a> {t('io.preferences.ecosystemDescSuffix')}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                    {t('io.preferences.originalProjectPrefix')}
                    <a href="https://github.com/MangoLion/stretchystudio" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                      MangoLion/stretchystudio
                    </a>
                    {t('io.preferences.originalProjectSuffix')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1.5" asChild>
                      <a href="https://github.com/shitagaki-lab/see-through" target="_blank" rel="noopener noreferrer">
                        {t('io.preferences.seeThroughRepo')}
                      </a>
                    </Button>
                    <Button variant="default" size="sm" className="h-7 text-[10px] gap-1.5" asChild>
                      <a href="https://huggingface.co/spaces/24yearsold/see-through-demo" target="_blank" rel="noopener noreferrer">
                        {t('io.preferences.freeSpace')}
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1.5" asChild>
                      <a href="https://github.com/MangoLion/stretchystudio" target="_blank" rel="noopener noreferrer">
                        {t('io.preferences.originalRepo')}
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-6">
                  <h4 className="text-sm font-semibold mb-2">{t('io.preferences.projectDetails')}</h4>
                  <div className="grid grid-cols-2 gap-y-2 text-xs">
                    <span className="text-muted-foreground">{t('io.preferences.framework')}</span>
                    <span>React + Vite</span>
                    <span className="text-muted-foreground">{t('io.preferences.styling')}</span>
                    <span>Tailwind CSS</span>
                    <span className="text-muted-foreground">{t('io.preferences.components')}</span>
                    <span>Radix UI + Shadcn UI</span>
                    <span className="text-muted-foreground">{t('io.preferences.icons')}</span>
                    <span>Lucide React</span>
                  </div>
                </div>

                <div className="border-t pt-6">
                  <h4 className="text-sm font-semibold mb-2">{t('io.preferences.acknowledgements')}</h4>
                  <div className="bg-muted/40 rounded-lg p-3">
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {t('io.preferences.thankyouPrefix')} <a href="https://github.com/pelmentor" target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">pelmentor</a> {t('io.preferences.thankyouSuffix')}
                    </p>
                  </div>
                </div>


              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

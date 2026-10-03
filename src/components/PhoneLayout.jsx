import React from 'react';
import { Palette, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTranslation } from '@/i18n';


const PhoneLayout = ({ children, isLandscape }) => {
  const { themeMode, setThemeMode, openThemeModal, setLightTheme, setDarkTheme } = useTheme();
  const { t } = useTranslation();

  const handleThemeSelectClick = () => {
    // 依据当前主题模式，打开对应的主题选择弹窗
    const config = themeMode === 'dark' ? {
      title: t('editor.phone.selectDarkTheme'),
      themes: darkThemePresets,
      onSelect: setDarkTheme,
    } : {
      title: t('editor.phone.selectLightTheme'),
      themes: lightThemePresets,
      onSelect: setLightTheme,
    };
    openThemeModal(config);
  };

  return (
    <>
      <div className="phone-shell relative">
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-28 h-5 bg-border rounded-b-lg z-30"></div>
        
        <div className="phone-screen">
          {children}
        </div>
      </div>

      {isLandscape && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              className="fixed bottom-4 right-4 rounded-full h-14 w-14 shadow-lg z-50"
            >
              <Palette size={24} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <div className="flex items-center gap-2">
              <ToggleGroup 
                type="single" 
                value={themeMode} 
                onValueChange={(value) => {
                  if (value) setThemeMode(value);
                }}
                aria-label={t('editor.phone.themeMode')}
              >
                <ToggleGroupItem value="light" aria-label={t('editor.phone.lightMode')}>
                  <Sun className="h-5 w-5" />
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label={t('editor.phone.darkMode')}>
                  <Moon className="h-5 w-5" />
                </ToggleGroupItem>
              </ToggleGroup>

              <Button
                variant="outline"
                onClick={handleThemeSelectClick}
              >
                {t('editor.phone.selectTheme')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};

export default PhoneLayout;

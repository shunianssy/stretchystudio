# JUMPSTART

本文档简要介绍项目的技术栈，以及如何通过编程方式自定义 UI。

## 技术栈

- **框架：** [React.js](https://react.dev/)
- **构建工具：** [Vite](https://vitejs.dev/)
- **UI 组件：** [Shadcn UI](https://ui.shadcn.com/)
- **样式：** [Tailwind CSS](https://tailwindcss.com/)
- **图标：** [Lucide React](https://lucide.dev/guide/packages/lucide-react)
- **字体：** [Fontsource](https://fontsource.org/)

## 自定义示例

主题和字体管理由位于 `src/contexts/ThemeProvider.jsx` 的自定义 `ThemeProvider` React context 负责处理。

要与主题交互，你可以使用 `useTheme` hook，它提供了对状态以及更新状态所需函数的访问。

### 设置主题

你可以更改主题模式（例如 'light'、'dark'、'system'），也可以分别为亮色和暗色模式设置特定的颜色预设。

**示例：**
```jsx
import { useTheme } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';

function ThemeControls() {
  const { setThemeMode, setLightTheme, setDarkTheme } = useTheme();

  // Find a specific theme preset by name
  const newLightTheme = lightThemePresets.find(p => p.name === 'Green');
  const newDarkTheme = darkThemePresets.find(p => p.name === 'Violet');

  return (
    <div>
      <button onClick={() => setThemeMode('dark')}>
        Set Dark Mode
      </button>
      <button onClick={() => setLightTheme(newLightTheme)}>
        Set Light Theme to Green
      </button>
      <button onClick={() => setDarkTheme(newDarkTheme)}>
        Set Dark Theme to Violet
      </button>
    </div>
  );
}
```

### 设置字体系列

你可以通过传入字体的 `id` 来动态更改应用程序的字体系列。

**示例：**
```jsx
import { useTheme } from '@/contexts/ThemeProvider';

function FontSelector() {
  const { setFontFamily } = useTheme();

  // The value should be one of the font IDs from AVAILABLE_FONTS
  const handleFontChange = (event) => {
    setFontFamily(event.target.value);
  };

  return (
    <select onChange={handleFontChange}>
      <option value="Inter">Inter</option>
      <option value="Roboto">Roboto</option>
      <option value="Poppins">Poppins</option>
    </select>
  );
}
```

### 设置字体大小

你可以调整应用程序的基础字体大小。

**示例：**
```jsx
import { useTheme } from '@/contexts/ThemeProvider';

function FontSizeControls() {
  const { fontSize, setFontSize } = useTheme();

  return (
    <div>
      <p>Current Font Size: {fontSize}px</p>
      <button onClick={() => setFontSize(fontSize + 1)}>
        Increase Font Size
      </button>
      <button onClick={() => setFontSize(fontSize - 1)}>
        Decrease Font Size
      </button>
    </div>
  );
}
```

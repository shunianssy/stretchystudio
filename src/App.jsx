import React from 'react';
import EditorLayout from '@/app/layout/EditorLayout';
import { Toaster } from '@/components/ui/toaster';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { useLanguageEffect } from '@/i18n';

function App() {
  // Mount global undo/redo keyboard handler
  useUndoRedo();
  // 同步当前语言到 <html lang> 与 document.title
  useLanguageEffect();

  return (
    <>
      <EditorLayout />
      <Toaster />
    </>
  );
}

export default App;

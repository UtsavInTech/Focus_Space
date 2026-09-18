import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import './popup.css';
import { PopupApp } from './PopupApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);

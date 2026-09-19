import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bindToOwner } from '@/storage/storage';
import '@/ui/styles.css';
import './dashboard.css';
import { DashboardApp } from './DashboardApp';

// A change of owner (sign-out, another account) reloads the page so it never shows the previous person's data.
void bindToOwner(() => location.reload());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);

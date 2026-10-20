import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@/ui/styles.css';
import './site.css';
import './light.css';
import './page-motion.css';
import { startReveal } from './reveal';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
startReveal();

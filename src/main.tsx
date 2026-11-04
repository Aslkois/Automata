import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PartsSheet } from './ui/PartsSheet';
import { App } from './ui/App';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{new URLSearchParams(location.search).has('parts-sheet') ? <PartsSheet /> : <App />}</StrictMode>,
);

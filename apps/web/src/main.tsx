import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { startServiceWorker } from './pwa/serviceWorkerClient';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './index.css';

// Offline-first: fonts are bundled via @fontsource, not fetched from a CDN (spec 13 #1).
//
// The service worker (spec 2.1, 11) is registered before the first render so
// every consumer subscribes to the same updater; a new build is offered as a
// reload prompt, never swapped in silently (src/pwa/registration.ts).
startServiceWorker();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);


import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import { setupWorker } from 'msw/browser';
import { App } from './App';
import { createHandlers } from './api/mocks';
import { StoreProvider } from './store/context';
import { createServer, createStore } from './store/createAppStore';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const { server, bootMs } = createServer();

// The "backend": MSW's service worker answers the app's fetch() calls inside the browser,
// so every list load, page of 20 and save shows up in DevTools → Network.
// It must be running before the store makes its first request.
await setupWorker(...createHandlers(server)).start({ quiet: true });

const store = createStore(server, 'http');

createRoot(root).render(
  <StrictMode>
    <StoreProvider store={store} server={server} bootMs={bootMs}>
      <App />
    </StoreProvider>
  </StrictMode>,
);

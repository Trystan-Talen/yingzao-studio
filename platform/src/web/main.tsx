import './lib/runtime-security';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StudioProvider } from './context';
import { ToastProvider } from './components/ui';
import { App } from './App';
import './styles.css';
import './styles/home.css';
import './styles/workbench.css';
import './styles/detail-page.css';
import './styles/studio.css';
import './styles/creative.css';
import './styles/home-quick.css';
import './styles/creation-refresh.css';
// 映造 2026 brand layer — must stay last so it re-skins every legacy stylesheet.
import './styles/brand/tokens.css';
import './styles/brand/foundation.css';
import './styles/brand/pages.css';
import './styles/brand/fixes.css';
import './styles/brand/display-font.css';
const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 15000, refetchOnWindowFocus: false } },
});
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ToastProvider>
        <StudioProvider>
          <App />
        </StudioProvider>
      </ToastProvider>
    ),
  },
]);
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

import './App.css';
import { render } from 'preact';
import { LocationProvider } from 'preact-iso/router';
import Layout, { Routes } from './App.tsx';

if (import.meta.env.DEV) {
  // Dev-time warnings and devtools support, like React's development build.
  await import('preact/debug');
}

render(
  <LocationProvider>
    <Layout>
      <Routes />
    </Layout>
  </LocationProvider>,
  document.getElementById('app')!,
);

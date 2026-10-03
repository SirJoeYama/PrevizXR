import './styles.css';
import { App } from './app/App';
import { Sidebar } from './ui/Sidebar';

const viewport = document.getElementById('viewport')!;
const sidebarEl = document.getElementById('sidebar')!;

const app = new App(viewport);
new Sidebar(sidebarEl, app);
app.start();

// Exposed for debugging in the browser console / emulator.
(window as unknown as { previz: App }).previz = app;

import './styles.css';
import { App } from './app/App';
import { Studio } from './app/Studio';
import { Sidebar } from './ui/Sidebar';

const viewport = document.getElementById('viewport')!;
const sidebarEl = document.getElementById('sidebar')!;

const app = new App(viewport);
const studio = new Studio(app);
new Sidebar(sidebarEl, studio);
app.start();
void studio.project.restore();

// Exposed for debugging in the browser console / emulator.
(window as unknown as { previz: Studio }).previz = studio;

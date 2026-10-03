import './styles.css';
import { App } from './app/App';
import { Studio } from './app/Studio';
import { Layout } from './ui/Layout';

const viewport = document.getElementById('viewport')!;

const app = new App(viewport);
const studio = new Studio(app);
new Layout(studio);
app.start();
void studio.project.restore();

// Exposed for debugging in the browser console / emulator.
(window as unknown as { previz: Studio }).previz = studio;

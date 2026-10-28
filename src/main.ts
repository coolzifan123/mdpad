import { App } from './app';
import './styles/app.css';
import './styles/theme.css';
import { applySavedTheme } from './theme';

applySavedTheme();

const byId = (id: string) => document.getElementById(id)!;

const app = new App({
  host: byId('editor-host'),
  docName: byId('doc-name'),
  dirtyMark: byId('dirty-mark'),
  statusMode: byId('status-mode'),
  statusCount: byId('status-count'),
  sourceButton: byId('source-button'),
});

void app.start();

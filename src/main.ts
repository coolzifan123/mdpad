import { App } from './app';
import './styles/app.css';
import './styles/theme.css';
import { applySavedTheme } from './theme';

applySavedTheme();

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const app = new App({
  host: byId('editor-host'),
  menuBar: byId('menu-bar'),
  docName: byId('doc-name'),
  dirtyMark: byId('dirty-mark'),
  statusMode: byId('status-mode'),
  statusCount: byId('status-count'),
  findBar: {
    bar: byId('find-bar'),
    input: byId('find-input'),
    count: byId('find-count'),
    matchCase: byId('find-case'),
    wholeWord: byId('find-word'),
    regex: byId('find-regex'),
    previous: byId('find-previous'),
    next: byId('find-next'),
    close: byId('find-close'),
    replaceRow: byId('replace-row'),
    replaceInput: byId('replace-input'),
    replaceOne: byId('replace-one'),
    replaceAll: byId('replace-all'),
  },
  sidebar: {
    sidebar: byId('sidebar'),
    tabs: { files: byId('tab-files'), outline: byId('tab-outline'), search: byId('tab-search') },
    panels: { files: byId('files-panel'), outline: byId('outline-panel'), search: byId('search-panel') },
  },
});

void app.start();

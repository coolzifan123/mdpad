// The sidebar on the left, with the Files and Outline panels. Whether it's
// open, and which panel, is remembered.

export type SidebarTab = 'files' | 'outline';

export interface SidebarElements {
  sidebar: HTMLElement;
  tabs: Record<SidebarTab, HTMLButtonElement>;
  panels: Record<SidebarTab, HTMLElement>;
}

const STORAGE_KEY = 'mdpad-sidebar';

export class Sidebar {
  private tab: SidebarTab = 'outline';

  constructor(
    private readonly ui: SidebarElements,
    /** Called when the sidebar opens or changes panel, to fill it. */
    private readonly onShow: (tab: SidebarTab) => void,
  ) {
    for (const tab of Object.keys(ui.tabs) as SidebarTab[]) {
      ui.tabs[tab].addEventListener('click', () => this.show(tab));
    }
    let saved: { visible?: boolean; tab?: SidebarTab } = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      // Use the defaults.
    }
    this.tab = saved.tab === 'files' ? 'files' : 'outline';
    this.apply(Boolean(saved.visible));
  }

  get visible(): boolean {
    return !this.ui.sidebar.hidden;
  }

  get activeTab(): SidebarTab {
    return this.tab;
  }

  toggle(): void {
    this.apply(!this.visible);
  }

  /** Open the sidebar on `tab`; if it's already showing, close it. */
  toggleTab(tab: SidebarTab): void {
    if (this.visible && this.tab === tab) this.apply(false);
    else this.show(tab);
  }

  show(tab: SidebarTab): void {
    this.tab = tab;
    this.apply(true);
  }

  private apply(visible: boolean): void {
    this.ui.sidebar.hidden = !visible;
    for (const tab of Object.keys(this.ui.tabs) as SidebarTab[]) {
      this.ui.tabs[tab].classList.toggle('active', tab === this.tab);
      this.ui.panels[tab].hidden = tab !== this.tab;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ visible, tab: this.tab }));
    } catch {
      // Not critical.
    }
    if (visible) this.onShow(this.tab);
  }
}

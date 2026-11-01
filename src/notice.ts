// Bars at the bottom right of the window that offer a choice ("MdPad 0.3.0 is
// available. Install / Later"). Several stack up.

/** Show `text` with two buttons. Resolves true for `accept`, false for `decline`. */
export function offerChoice(text: string, accept: string, decline: string, className: string): Promise<boolean> {
  let area = document.querySelector<HTMLElement>('.notice-area');
  if (!area) {
    area = Object.assign(document.createElement('div'), { className: 'notice-area' });
    document.body.append(area);
  }
  document.querySelector(`.notice-bar.${className}`)?.remove();
  return new Promise((resolve) => {
    const bar = document.createElement('div');
    bar.className = `notice-bar ${className}`;
    bar.setAttribute('role', 'status');
    const message = Object.assign(document.createElement('span'), { textContent: text });
    const yes = Object.assign(document.createElement('button'), { textContent: accept, className: 'primary' });
    const no = Object.assign(document.createElement('button'), { textContent: decline });
    bar.append(message, yes, no);
    area.append(bar);
    const finish = (choice: boolean) => {
      bar.remove();
      resolve(choice);
    };
    yes.addEventListener('click', () => finish(true));
    no.addEventListener('click', () => finish(false));
  });
}

// A small in-app dialog that asks for one line of text (e.g. a link's URL).
// window.prompt() isn't available inside the desktop app.

export function askText(title: string, options: { value?: string; placeholder?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('form');
    dialog.className = 'dialog';
    const label = Object.assign(document.createElement('label'), { textContent: title });
    const input = Object.assign(document.createElement('input'), {
      type: 'text',
      value: options.value ?? '',
      placeholder: options.placeholder ?? '',
      spellcheck: false,
    });
    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' });
    const ok = Object.assign(document.createElement('button'), { type: 'submit', textContent: 'OK', className: 'primary' });
    buttons.append(cancel, ok);
    label.append(input);
    dialog.append(label, buttons);
    backdrop.append(dialog);
    document.body.append(backdrop);

    const finish = (value: string | null) => {
      backdrop.remove();
      resolve(value);
    };
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      finish(input.value.trim());
    });
    cancel.addEventListener('click', () => finish(null));
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish(null);
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    });
    input.focus();
    input.select();
  });
}

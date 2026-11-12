/**
 * A pop-up chooser: a title, tabs, and a body each tab draws. It sits on the document body,
 * outside the page the editor redraws, so a redraw behind it does not take it away; Escape,
 * the close button or a click outside closes it.
 */

export interface PickerTab {
  name: string;
  /** Draw the tab's body; `close` closes the chooser, as picking something does. */
  render: (close: () => void) => HTMLElement;
}

let open: HTMLElement | null = null;

function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** Escape closes the chooser wherever focus is, while one is open. */
function onEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || open === null) return;
  event.stopPropagation();
  closePicker();
}

export function closePicker(): void {
  open?.remove();
  open = null;
  document.removeEventListener("keydown", onEscape, true);
}

export function pickerOpen(): boolean {
  return open !== null;
}

export function openPicker(title: string, tabs: readonly PickerTab[], first = 0): void {
  closePicker();
  const overlay = el("div", { class: "picker-overlay", role: "presentation" });
  const dialog = el("div", { class: "picker-dialog", role: "dialog", "aria-label": title });
  const close = (): void => {
    closePicker();
  };
  const closeButton = el(
    "button",
    { class: "btn small picker-close", type: "button", "aria-label": "Close" },
    ["×"],
  );
  closeButton.addEventListener("click", close);
  const bar = el("div", { class: "picker-tabs" });
  const body = el("div", { class: "picker-body" });
  const show = (index: number): void => {
    for (const [at, button] of [...bar.children].entries()) {
      button.classList.toggle("primary", at === index);
    }
    const tab = tabs[index];
    body.replaceChildren(tab === undefined ? "" : tab.render(close));
    // Into the chooser: its search box, or else its first button, so the keyboard -- and
    // Escape -- work in it and not on the page behind.
    (
      body.querySelector<HTMLElement>("input") ?? dialog.querySelector<HTMLElement>("button")
    )?.focus();
  };
  tabs.forEach((tab, index) => {
    const button = el(
      "button",
      { class: "btn small", type: "button", "data-picker-tab": tab.name },
      [tab.name],
    );
    button.addEventListener("click", () => {
      show(index);
    });
    bar.append(button);
  });
  dialog.append(el("div", { class: "picker-head" }, [el("b", {}, [title]), closeButton]));
  if (tabs.length > 1) dialog.append(bar);
  dialog.append(body);
  overlay.append(dialog);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  open = overlay;
  document.addEventListener("keydown", onEscape, true);
  show(Math.min(first, Math.max(0, tabs.length - 1)));
}

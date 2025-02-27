// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as LitHtml from '../../lit-html/lit-html.js';
import * as ComponentHelpers from '../helpers/helpers.js';
import * as IconButton from '../icon_button/icon_button.js';

import buttonStyles from './button.css.js';

declare global {
  interface HTMLElementTagNameMap {
    'devtools-button': Button;
  }
}

export const enum Variant {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
  TOOLBAR = 'toolbar',
  ROUND = 'round',
}

export const enum Size {
  SMALL = 'SMALL',
  MEDIUM = 'MEDIUM',
}

type ButtonType = 'button'|'submit'|'reset';

interface ButtonState {
  iconUrl?: string;
  variant?: Variant;
  size?: Size;
  disabled: boolean;
  active: boolean;
  spinner?: boolean;
  type: ButtonType;
  value?: string;
  title?: string;
}

export type ButtonData = {
  variant: Variant.TOOLBAR|Variant.ROUND,
  iconUrl: string,
  size?: Size,
  disabled?: boolean,
  active?: boolean,
  spinner?: boolean,
  type?: ButtonType,
  value?: string,
  title?: string,
}|{
  variant: Variant.PRIMARY | Variant.SECONDARY,
  iconUrl?: string,
  size?: Size,
  disabled?: boolean,
  active?: boolean,
  spinner?: boolean,
  type?: ButtonType,
  value?: string,
  title?: string,
};

interface ButtonElementInternals extends ElementInternals {
  readonly form: HTMLFormElement|null;
  readonly validity: ValidityState;
  readonly willValidate: boolean;
  readonly validationMessage: string;
  checkValidity(): void;
  reportValidity(): void;
}

export class Button extends HTMLElement {
  static formAssociated = true;
  static readonly litTagName = LitHtml.literal`devtools-button`;
  readonly #shadow = this.attachShadow({mode: 'open', delegatesFocus: true});
  readonly #boundRender = this.#render.bind(this);
  readonly #boundOnClick = this.#onClick.bind(this);
  readonly #props: ButtonState = {
    size: Size.MEDIUM,
    disabled: false,
    active: false,
    spinner: false,
    type: 'button',
  };
  #isEmpty = true;
  #internals = this.attachInternals() as ButtonElementInternals;

  constructor() {
    super();
    this.setAttribute('role', 'presentation');
    this.addEventListener('click', this.#boundOnClick, true);
  }

  /**
   * Perfer using the .data= setter instead of setting the individual properties
   * for increased type-safety.
   */
  set data(data: ButtonData) {
    this.#props.variant = data.variant;
    this.#props.iconUrl = data.iconUrl;
    this.#props.size = data.size || Size.MEDIUM;
    this.#props.active = Boolean(data.active);
    this.#props.spinner = Boolean(data.spinner);
    this.#props.type = data.type || 'button';
    this.#setDisabledProperty(data.disabled || false);
    this.#props.title = data.title;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  set iconUrl(iconUrl: string|undefined) {
    this.#props.iconUrl = iconUrl;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  set variant(variant: Variant) {
    this.#props.variant = variant;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  set size(size: Size) {
    this.#props.size = size;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  set type(type: ButtonType) {
    this.#props.type = type;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  set title(title: string) {
    this.#props.title = title;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  set disabled(disabled: boolean) {
    this.#setDisabledProperty(disabled);
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  set active(active: boolean) {
    this.#props.active = active;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  set spinner(spinner: boolean) {
    this.#props.spinner = spinner;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  #setDisabledProperty(disabled: boolean): void {
    this.#props.disabled = disabled;
    this.toggleAttribute('disabled', disabled);
  }

  focus(): void {
    this.#shadow.querySelector('button')?.focus();
  }

  connectedCallback(): void {
    this.#shadow.adoptedStyleSheets = [buttonStyles];
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  #onClick(event: Event): void {
    if (this.#props.disabled) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (this.form && this.#props.type === 'submit') {
      event.preventDefault();
      this.form.dispatchEvent(new SubmitEvent('submit', {
        submitter: this,
      }));
    }
    if (this.form && this.#props.type === 'reset') {
      event.preventDefault();
      this.form.reset();
    }
  }

  #onSlotChange(event: Event): void {
    const slot = event.target as HTMLSlotElement | undefined;
    const nodes = slot?.assignedNodes();
    this.#isEmpty = !nodes || !Boolean(nodes.length);
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  #render(): void {
    if (!this.#props.variant) {
      throw new Error('Button requires a variant to be defined');
    }
    if (this.#props.variant === Variant.TOOLBAR) {
      if (!this.#props.iconUrl) {
        throw new Error('Toolbar button requires an icon');
      }
      if (!this.#isEmpty) {
        throw new Error('Tooblar button does not accept children');
      }
    }
    if (this.#props.variant === Variant.ROUND) {
      if (!this.#props.iconUrl) {
        throw new Error('Round button requires an icon');
      }
      if (!this.#isEmpty) {
        throw new Error('Round button does not accept children');
      }
    }
    const classes = {
      primary: this.#props.variant === Variant.PRIMARY,
      secondary: this.#props.variant === Variant.SECONDARY,
      toolbar: this.#props.variant === Variant.TOOLBAR,
      round: this.#props.variant === Variant.ROUND,
      'text-with-icon': Boolean(this.#props.iconUrl) && !this.#isEmpty,
      'only-icon': Boolean(this.#props.iconUrl) && this.#isEmpty,
      small: Boolean(this.#props.size === Size.SMALL),
      active: this.#props.active,
    };
    const spinnerClasses = {
      primary: this.#props.variant === Variant.PRIMARY,
      secondary: this.#props.variant === Variant.SECONDARY,
      disabled: Boolean(this.#props.disabled),
      'spinner-component': true,
    };
    // clang-format off
    LitHtml.render(
      LitHtml.html`
        <button title=${LitHtml.Directives.ifDefined(this.#props.title)} .disabled=${this.#props.disabled} class=${LitHtml.Directives.classMap(classes)}>
          ${this.#props.iconUrl ? LitHtml.html`<${IconButton.Icon.Icon.litTagName}
            .data=${{
              iconPath: this.#props.iconUrl,
              color: 'var(--color-background)',
            } as IconButton.Icon.IconData}
          >
          </${IconButton.Icon.Icon.litTagName}>` : ''}
          ${this.#props.spinner ? LitHtml.html`<span class=${LitHtml.Directives.classMap(spinnerClasses)}></span>` : ''}
          <slot @slotchange=${this.#onSlotChange}></slot>
        </button>
      `, this.#shadow, {host: this});
    // clang-format on
  }

  // Based on https://web.dev/more-capable-form-controls/ to make custom elements form-friendly.
  // Form controls usually expose a "value" property.
  get value(): string {
    return this.#props.value || '';
  }
  set value(value: string) {
    this.#props.value = value;
  }

  // The following properties and methods aren't strictly required,
  // but browser-level form controls provide them. Providing them helps
  // ensure consistency with browser-provided controls.
  get form(): HTMLFormElement|null {
    return this.#internals.form;
  }
  get name(): string|null {
    return this.getAttribute('name');
  }
  get type(): ButtonType {
    return this.#props.type;
  }
  get validity(): ValidityState {
    return this.#internals.validity;
  }
  get validationMessage(): string {
    return this.#internals.validationMessage;
  }
  get willValidate(): boolean {
    return this.#internals.willValidate;
  }
  checkValidity(): void {
    return this.#internals.checkValidity();
  }
  reportValidity(): void {
    return this.#internals.reportValidity();
  }
}

ComponentHelpers.CustomElements.defineComponent('devtools-button', Button);

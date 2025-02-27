// Copyright (c) 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as ComponentHelpers from '../../../components/helpers/helpers.js';
import * as LitHtml from '../../../lit-html/lit-html.js';
import cssAngleStyles from './cssAngle.css.js';

import type {Angle} from './CSSAngleUtils.js';
import {
  AngleUnit,
  convertAngleUnit,
  getNewAngleFromEvent,
  getNextUnit,
  parseText,
  roundAngleByUnit,
} from './CSSAngleUtils.js';
import {ValueChangedEvent} from './InlineEditorUtils.js';

import type {CSSAngleEditorData} from './CSSAngleEditor.js';
import {CSSAngleEditor} from './CSSAngleEditor.js';
import type {CSSAngleSwatchData} from './CSSAngleSwatch.js';
import {CSSAngleSwatch} from './CSSAngleSwatch.js';

const {render, html} = LitHtml;
const styleMap = LitHtml.Directives.styleMap;

const ContextAwareProperties = new Set(['color', 'background', 'background-color']);

export class PopoverToggledEvent extends Event {
  static readonly eventName = 'popovertoggled';
  data: {open: boolean};

  constructor(open: boolean) {
    super(PopoverToggledEvent.eventName, {});
    this.data = {open};
  }
}

export class UnitChangedEvent extends Event {
  static readonly eventName = 'unitchanged';
  data: {value: string};

  constructor(value: string) {
    super(UnitChangedEvent.eventName, {});
    this.data = {value};
  }
}

export interface CSSAngleData {
  propertyName: string;
  propertyValue: string;
  angleText: string;
  containingPane: HTMLElement;
}

const DefaultAngle = {
  value: 0,
  unit: AngleUnit.Rad,
};

export class CSSAngle extends HTMLElement {
  static readonly litTagName = LitHtml.literal`devtools-css-angle`;
  private readonly shadow = this.attachShadow({mode: 'open'});
  private angle: Angle = DefaultAngle;
  private displayedAngle: Angle = DefaultAngle;
  private propertyName = '';
  private propertyValue = '';
  private containingPane?: HTMLElement;
  private angleElement: HTMLElement|null = null;
  private swatchElement: HTMLElement|null = null;
  private popoverOpen = false;
  private popoverStyleTop = '';
  private popoverStyleLeft = '';
  private onMinifyingAction = this.minify.bind(this);

  connectedCallback(): void {
    this.shadow.adoptedStyleSheets = [cssAngleStyles];
  }

  set data(data: CSSAngleData) {
    const parsedResult = parseText(data.angleText);
    if (!parsedResult) {
      return;
    }
    this.angle = parsedResult;
    this.displayedAngle = {...parsedResult};
    this.propertyName = data.propertyName;
    this.propertyValue = data.propertyValue;
    this.containingPane = data.containingPane;
    this.render();
  }

  disconnectedCallback(): void {
    this.unbindMinifyingAction();
  }

  // We bind and unbind mouse event listeners upon popping over and minifying,
  // because we anticipate most of the time this widget is minified even when
  // it's attached to the DOM tree.
  popover(): void {
    if (!this.containingPane) {
      return;
    }

    if (!this.angleElement) {
      this.angleElement = this.shadow.querySelector<HTMLElement>('.css-angle');
    }
    if (!this.swatchElement) {
      this.swatchElement = this.shadow.querySelector<HTMLElement>('devtools-css-angle-swatch');
    }
    if (!this.angleElement || !this.swatchElement) {
      return;
    }

    this.dispatchEvent(new PopoverToggledEvent(true));
    this.bindMinifyingAction();

    const miniIconBottom = this.swatchElement.getBoundingClientRect().bottom;
    const miniIconLeft = this.swatchElement.getBoundingClientRect().left;
    if (miniIconBottom && miniIconLeft) {
      this.popoverStyleTop = `${miniIconBottom}px`;
      this.popoverStyleLeft = `${miniIconLeft}px`;
    }

    this.popoverOpen = true;
    this.render();
    this.angleElement.focus();
  }

  minify(): void {
    if (this.popoverOpen === false) {
      return;
    }

    this.popoverOpen = false;
    this.dispatchEvent(new PopoverToggledEvent(false));
    this.unbindMinifyingAction();
    this.render();
  }

  updateProperty(name: string, value: string): void {
    this.propertyName = name;
    this.propertyValue = value;
    this.render();
  }

  private updateAngle(angle: Angle): void {
    this.displayedAngle = roundAngleByUnit(convertAngleUnit(angle, this.displayedAngle.unit));
    this.angle = this.displayedAngle;
    this.dispatchEvent(new ValueChangedEvent(`${this.angle.value}${this.angle.unit}`));
  }

  private displayNextUnit(): void {
    const nextUnit = getNextUnit(this.displayedAngle.unit);
    this.displayedAngle = roundAngleByUnit(convertAngleUnit(this.angle, nextUnit));
    this.dispatchEvent(new UnitChangedEvent(`${this.displayedAngle.value}${this.displayedAngle.unit}`));
  }

  private bindMinifyingAction(): void {
    document.addEventListener('mousedown', this.onMinifyingAction);
    if (this.containingPane) {
      this.containingPane.addEventListener('scroll', this.onMinifyingAction);
    }
  }

  private unbindMinifyingAction(): void {
    document.removeEventListener('mousedown', this.onMinifyingAction);
    if (this.containingPane) {
      this.containingPane.removeEventListener('scroll', this.onMinifyingAction);
    }
  }

  private onMiniIconClick(event: MouseEvent): void {
    event.stopPropagation();
    if (event.shiftKey && !this.popoverOpen) {
      this.displayNextUnit();
      return;
    }
    this.popoverOpen ? this.minify() : this.popover();
  }

  // Fix that the previous text will be selected when double-clicking the angle icon
  private consume(event: MouseEvent): void {
    event.stopPropagation();
  }

  private onKeydown(event: KeyboardEvent): void {
    if (!this.popoverOpen) {
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.stopPropagation();
        this.minify();
        this.blur();
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        const newAngle = getNewAngleFromEvent(this.angle, event);
        if (newAngle) {
          this.updateAngle(newAngle);
        }
        event.preventDefault();
        break;
      }
    }
  }

  private render(): void {
    // Disabled until https://crbug.com/1079231 is fixed.
    // clang-format off
    render(html`
      <div class="css-angle" @keydown=${this.onKeydown} tabindex="-1">
        <div class="preview">
          <${CSSAngleSwatch.litTagName}
            @click=${this.onMiniIconClick}
            @mousedown=${this.consume}
            @dblclick=${this.consume}
            .data=${{
              angle: this.angle,
            } as CSSAngleSwatchData}>
          </${CSSAngleSwatch.litTagName}><slot></slot></div>
        ${this.popoverOpen ? this.renderPopover() : null}
      </div>
    `, this.shadow, {
      host: this,
    });
    // clang-format on
  }

  private renderPopover(): LitHtml.TemplateResult {
    let contextualBackground = '';
    // TODO(crbug.com/1143010): for now we ignore values with "url"; when we refactor
    // CSS value parsing we should properly apply atomic contextual background.
    if (ContextAwareProperties.has(this.propertyName) && !this.propertyValue.match(/url\(.*\)/i)) {
      contextualBackground = this.propertyValue;
    }

    // Disabled until https://crbug.com/1079231 is fixed.
    // clang-format off
    return html`
    <${CSSAngleEditor.litTagName}
      class="popover popover-css-angle"
      style=${styleMap({top: this.popoverStyleTop, left: this.popoverStyleLeft})}
      .data=${{
        angle: this.angle,
        onAngleUpdate: (angle: Angle):void => {
          this.updateAngle(angle);
        },
        background: contextualBackground,
      } as CSSAngleEditorData}
    ></${CSSAngleEditor.litTagName}>
    `;
    // clang-format on
  }
}

ComponentHelpers.CustomElements.defineComponent('devtools-css-angle', CSSAngle);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLElementTagNameMap {
    'devtools-css-angle': CSSAngle;
  }
}

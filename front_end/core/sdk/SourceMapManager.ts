// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../common/common.js';
import * as i18n from '../i18n/i18n.js';
import * as Platform from '../platform/platform.js';

import type {FrameAssociated} from './FrameAssociated.js';
import type {Target} from './Target.js';
import {Type} from './Target.js';
import {Events as TargetManagerEvents, TargetManager} from './TargetManager.js';
import type {SourceMap} from './SourceMap.js';
import {TextSourceMap} from './SourceMap.js';

const UIStrings = {
  /**
  *@description Error message when failing to load a source map text
  *@example {An error occurred} PH1
  */
  devtoolsFailedToLoadSourcemapS: 'DevTools failed to load source map: {PH1}',
};
const str_ = i18n.i18n.registerUIStrings('core/sdk/SourceMapManager.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

export class SourceMapManager<T extends FrameAssociated> extends Common.ObjectWrapper.ObjectWrapper<EventTypes<T>> {
  readonly #target: Target;
  #isEnabled: boolean;
  readonly #relativeSourceURL: Map<T, Platform.DevToolsPath.UrlString>;
  readonly #relativeSourceMapURL: Map<T, Platform.DevToolsPath.UrlString>;
  #resolvedSourceMapId: Map<T, string>;
  readonly #sourceMapById: Map<string, SourceMap>;
  #sourceMapIdToLoadingClients: Platform.MapUtilities.Multimap<string, T>;
  #sourceMapIdToClients: Platform.MapUtilities.Multimap<string, T>;

  constructor(target: Target) {
    super();

    this.#target = target;
    this.#isEnabled = true;

    this.#relativeSourceURL = new Map();
    this.#relativeSourceMapURL = new Map();
    this.#resolvedSourceMapId = new Map();

    this.#sourceMapById = new Map();
    this.#sourceMapIdToLoadingClients = new Platform.MapUtilities.Multimap();
    this.#sourceMapIdToClients = new Platform.MapUtilities.Multimap();

    TargetManager.instance().addEventListener(TargetManagerEvents.InspectedURLChanged, this.inspectedURLChanged, this);
  }

  setEnabled(isEnabled: boolean): void {
    if (isEnabled === this.#isEnabled) {
      return;
    }
    this.#isEnabled = isEnabled;
    // We need this copy, because `this.#resolvedSourceMapId` is getting modified
    // in the loop body and trying to iterate over it at the same time leads to
    // an infinite loop.
    const clients = [...this.#resolvedSourceMapId.keys()];
    for (const client of clients) {
      const relativeSourceURL = this.#relativeSourceURL.get(client);
      const relativeSourceMapURL = this.#relativeSourceMapURL.get(client);
      this.detachSourceMap(client);
      this.attachSourceMap(client, relativeSourceURL, relativeSourceMapURL);
    }
  }

  private getBaseUrl(): Platform.DevToolsPath.UrlString {
    let target: Target|null = this.#target;
    while (target && target.type() !== Type.Frame) {
      target = target.parentTarget();
    }
    return target?.inspectedURL() ?? Platform.DevToolsPath.EmptyUrlString;
  }

  private inspectedURLChanged(event: Common.EventTarget.EventTargetEvent<Target>): void {
    if (event.data !== this.#target) {
      return;
    }

    // We need this copy, because `this.#resolvedSourceMapId` is getting modified
    // in the loop body and trying to iterate over it at the same time leads to
    // an infinite loop.
    const prevSourceMapIds = new Map(this.#resolvedSourceMapId);
    for (const [client, prevSourceMapId] of prevSourceMapIds) {
      const relativeSourceURL = this.#relativeSourceURL.get(client);
      const relativeSourceMapURL = this.#relativeSourceMapURL.get(client);
      if (relativeSourceURL === undefined || relativeSourceMapURL === undefined) {
        continue;
      }
      const resolvedUrls = this.resolveRelativeURLs(relativeSourceURL, relativeSourceMapURL);
      if (resolvedUrls !== null && prevSourceMapId !== resolvedUrls.sourceMapId) {
        this.detachSourceMap(client);
        this.attachSourceMap(client, relativeSourceURL, relativeSourceMapURL);
      }
    }
  }

  sourceMapForClient(client: T): SourceMap|null {
    const sourceMapId = this.#resolvedSourceMapId.get(client);
    if (!sourceMapId) {
      return null;
    }
    return this.#sourceMapById.get(sourceMapId) || null;
  }

  // This method actively awaits the source map, if still loading.
  sourceMapForClientPromise(client: T): Promise<SourceMap|null> {
    const sourceMapId = this.#resolvedSourceMapId.get(client);
    if (!sourceMapId) {
      // The source map has detached or none exists for this client.
      return Promise.resolve(null);
    }

    const sourceMap = this.sourceMapForClient(client);
    if (sourceMap) {
      return Promise.resolve(sourceMap);
    }

    if (!this.#sourceMapIdToLoadingClients.has(sourceMapId)) {
      // The source map failed to attach.
      return Promise.resolve(null);
    }

    return new Promise(resolve => {
      const sourceMapAddedDescriptor = this.addEventListener(Events.SourceMapAttached, event => {
        if (event.data.client !== client) {
          return;
        }
        this.removeEventListener(Events.SourceMapAttached, sourceMapAddedDescriptor.listener);
        this.removeEventListener(Events.SourceMapFailedToAttach, sourceMapFailedDescriptor.listener);
        resolve(event.data.sourceMap);
      });
      const sourceMapFailedDescriptor = this.addEventListener(Events.SourceMapFailedToAttach, event => {
        if (event.data.client !== client) {
          return;
        }
        this.removeEventListener(Events.SourceMapAttached, sourceMapAddedDescriptor.listener);
        this.removeEventListener(Events.SourceMapFailedToAttach, sourceMapFailedDescriptor.listener);
        resolve(null);
      });
    });
  }

  clientsForSourceMap(sourceMap: SourceMap): T[] {
    const sourceMapId = this.getSourceMapId(sourceMap.compiledURL(), sourceMap.url());
    if (this.#sourceMapIdToClients.has(sourceMapId)) {
      return [...this.#sourceMapIdToClients.get(sourceMapId)];
    }
    return [...this.#sourceMapIdToLoadingClients.get(sourceMapId)];
  }

  private getSourceMapId(sourceURL: Platform.DevToolsPath.UrlString, sourceMapURL: Platform.DevToolsPath.UrlString):
      string {
    return `${sourceURL}:${sourceMapURL}`;
  }

  private resolveRelativeURLs(
      sourceURL: Platform.DevToolsPath.UrlString, sourceMapURL: Platform.DevToolsPath.UrlString): {
    sourceURL: Platform.DevToolsPath.UrlString,
    sourceMapURL: Platform.DevToolsPath.UrlString,
    sourceMapId: string,
  }|null {
    // |#sourceURL| can be a random string, but is generally an absolute path.
    // Complete it to inspected page url for relative links.
    const resolvedSourceURL = Common.ParsedURL.ParsedURL.completeURL(this.getBaseUrl(), sourceURL);
    if (!resolvedSourceURL) {
      return null;
    }
    const resolvedSourceMapURL = Common.ParsedURL.ParsedURL.completeURL(resolvedSourceURL, sourceMapURL);
    if (!resolvedSourceMapURL) {
      return null;
    }
    return {
      sourceURL: resolvedSourceURL,
      sourceMapURL: resolvedSourceMapURL,
      sourceMapId: this.getSourceMapId(resolvedSourceURL, resolvedSourceMapURL),
    };
  }

  attachSourceMap(
      client: T, relativeSourceURL: Platform.DevToolsPath.UrlString|undefined,
      relativeSourceMapURL: Platform.DevToolsPath.UrlString|undefined): void {
    // TODO(chromium:1011811): Strengthen the type to obsolte the undefined check once core/sdk/ is fully typescriptified.
    if (relativeSourceURL === undefined || !relativeSourceMapURL) {
      return;
    }
    console.assert(!this.#resolvedSourceMapId.has(client), 'SourceMap is already attached to client');
    const resolvedURLs = this.resolveRelativeURLs(relativeSourceURL, relativeSourceMapURL);
    if (!resolvedURLs) {
      return;
    }
    this.#relativeSourceURL.set(client, relativeSourceURL);
    this.#relativeSourceMapURL.set(client, relativeSourceMapURL);

    const {sourceURL, sourceMapURL, sourceMapId} = resolvedURLs;
    this.#resolvedSourceMapId.set(client, sourceMapId);

    if (!this.#isEnabled) {
      return;
    }

    this.dispatchEventToListeners(Events.SourceMapWillAttach, {client});

    if (this.#sourceMapById.has(sourceMapId)) {
      attach.call(this, sourceMapId, client);
      return;
    }
    if (!this.#sourceMapIdToLoadingClients.has(sourceMapId)) {
      void TextSourceMap.load(sourceMapURL, sourceURL, client.createPageResourceLoadInitiator())
          .catch(error => {
            Common.Console.Console.instance().warn(
                i18nString(UIStrings.devtoolsFailedToLoadSourcemapS, {PH1: error.message}));
            return null;
          })
          .then(onSourceMap.bind(this, sourceMapId));
    }
    this.#sourceMapIdToLoadingClients.set(sourceMapId, client);

    function onSourceMap(this: SourceMapManager<T>, sourceMapId: string, sourceMap: SourceMap|null): void {
      this.sourceMapLoadedForTest();
      const clients = this.#sourceMapIdToLoadingClients.get(sourceMapId);
      this.#sourceMapIdToLoadingClients.deleteAll(sourceMapId);
      if (!clients.size) {
        return;
      }
      if (!sourceMap) {
        for (const client of clients) {
          this.dispatchEventToListeners(Events.SourceMapFailedToAttach, {client});
        }
        return;
      }
      this.#sourceMapById.set(sourceMapId, sourceMap);
      for (const client of clients) {
        attach.call(this, sourceMapId, client);
      }
    }

    function attach(this: SourceMapManager<T>, sourceMapId: string, client: T): void {
      this.#sourceMapIdToClients.set(sourceMapId, client);
      const sourceMap = this.#sourceMapById.get(sourceMapId) as SourceMap;
      this.dispatchEventToListeners(Events.SourceMapAttached, {client, sourceMap});
    }
  }

  detachSourceMap(client: T): void {
    const sourceMapId = this.#resolvedSourceMapId.get(client);
    this.#relativeSourceURL.delete(client);
    this.#relativeSourceMapURL.delete(client);
    this.#resolvedSourceMapId.delete(client);

    if (!sourceMapId) {
      return;
    }
    if (!this.#sourceMapIdToClients.hasValue(sourceMapId, client)) {
      if (this.#sourceMapIdToLoadingClients.delete(sourceMapId, client)) {
        this.dispatchEventToListeners(Events.SourceMapFailedToAttach, {client});
      }
      return;
    }
    this.#sourceMapIdToClients.delete(sourceMapId, client);
    const sourceMap = this.#sourceMapById.get(sourceMapId);
    if (!sourceMap) {
      return;
    }
    if (!this.#sourceMapIdToClients.has(sourceMapId)) {
      this.#sourceMapById.delete(sourceMapId);
    }
    this.dispatchEventToListeners(Events.SourceMapDetached, {client, sourceMap});
  }

  private sourceMapLoadedForTest(): void {
  }

  dispose(): void {
    TargetManager.instance().removeEventListener(
        TargetManagerEvents.InspectedURLChanged, this.inspectedURLChanged, this);
  }
}

// TODO(crbug.com/1167717): Make this a const enum again
// eslint-disable-next-line rulesdir/const_enum
export enum Events {
  SourceMapWillAttach = 'SourceMapWillAttach',
  SourceMapFailedToAttach = 'SourceMapFailedToAttach',
  SourceMapAttached = 'SourceMapAttached',
  SourceMapDetached = 'SourceMapDetached',
}

export type EventTypes<T extends FrameAssociated> = {
  [Events.SourceMapWillAttach]: {client: T},
  [Events.SourceMapFailedToAttach]: {client: T},
  [Events.SourceMapAttached]: {client: T, sourceMap: SourceMap},
  [Events.SourceMapDetached]: {client: T, sourceMap: SourceMap},
};

/*
 * Copyright 2017 IBM Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-dupe-class-members */

import { EventEmitter } from 'events'

import { ExecType } from '../models/command'
import { ScalarResponse } from '../models/entity'
import MultiModalResponse from '../models/mmr/types'
import NavResponse from '../models/NavResponse'
import Tab, { getPrimaryTabId } from '../webapp/tab'
import { CommandStartEvent, CommandCompleteEvent, CommandStartHandler, CommandCompleteHandler } from '../repl/events'

const eventChannelUnsafe = new EventEmitter()
eventChannelUnsafe.setMaxListeners(100)

export default eventChannelUnsafe

class EventBusBase {
  protected readonly eventBus: EventEmitter

  public constructor() {
    const eventBus = new EventEmitter()
    eventBus.setMaxListeners(100)
    this.eventBus = eventBus
  }
}

class WriteEventBus extends EventBusBase {
  public emit(channel: '/tab/new' | '/tab/close' | '/tab/offline', tab: Tab): void
  public emit(channel: '/tab/new/request'): void
  public emit(channel: '/tab/switch/request', idx: number): void
  public emit(channel: string, args?: any) {
    return this.eventBus.emit(channel, args)
  }

  private emitCommandEvent(which: 'start' | 'complete', event: CommandStartEvent | CommandCompleteEvent) {
    this.eventBus.emit(`/command/${which}`, event)

    if (event.execType !== ExecType.Nested) {
      this.eventBus.emit(`/command/${which}/fromuser`, event)
      this.eventBus.emit(`/command/${which}/fromuser/${event.tab.uuid}`, event)

      const primary = getPrimaryTabId(event.tab)
      if (event.tab.uuid !== primary) {
        this.eventBus.emit(`/command/${which}/fromuser/${primary}`, event)
      }

      this.eventBus.emit(`/command/${which}/fromuser/${primary}/type/${event.execType}`, event)
    }
  }

  public emitCommandStart(event: CommandStartEvent): void {
    this.emitCommandEvent('start', event)
  }

  public emitCommandComplete(event: CommandCompleteEvent): void {
    this.emitCommandEvent('complete', event)

    if (event.execType !== ExecType.Nested) {
      this.eventBus.emit(`/command/complete/fromuser/${event.responseType}`, event)
      this.eventBus.emit(`/command/complete/fromuser/${event.responseType}/${event.tab.uuid}`, event)

      const primary = getPrimaryTabId(event.tab)
      if (primary !== event.tab.uuid) {
        this.eventBus.emit(`/command/complete/fromuser/${event.responseType}/${primary}`, event)
      }
    }
  }

  public emitWithTabId(channel: '/tab/offline' | '/tab/close/request', tabId: string, tab?: Tab): void {
    this.eventBus.emit(`${channel}/${tabId}`, tabId, tab)
  }
}

class ReadEventBus extends WriteEventBus {
  public on(
    channel: '/tab/new' | '/tab/close/request' | '/tab/close' | '/tab/offline',
    listener: (tab: Tab) => void
  ): void

  public on(channel: '/tab/new/request', listener: () => void): void
  public on(channel: '/tab/switch/request', listener: (tabId: number) => void): void
  public on(channel: string, listener: any) {
    return this.eventBus.on(channel, listener)
  }

  private onCommand(
    which: 'start' | 'complete',
    splitId: string,
    splitHandler: CommandStartHandler | CommandCompleteHandler,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.eventBus.on(`/command/${which}/fromuser/${splitId}`, splitHandler)

    if (tabId) {
      this.eventBus.on(`/command/${which}/fromuser/${tabId}/type/${ExecType.ClickHandler}`, tabHandler)
    }
  }

  private offCommand(
    which: 'start' | 'complete',
    splitId: string,
    splitHandler: CommandStartHandler | CommandCompleteHandler,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.eventBus.off(`/command/${which}/fromuser/${splitId}`, splitHandler)

    if (tabId) {
      this.eventBus.off(`/command/${which}/fromuser/${tabId}/type/${ExecType.ClickHandler}`, tabHandler)
    }
  }

  public onAnyCommandStart(handler: CommandStartHandler) {
    this.eventBus.on('/command/start/fromuser', handler)
  }

  public offAnyCommandStart(handler: CommandStartHandler) {
    this.eventBus.on('/command/start/fromuser', handler)
  }

  public onAnyCommandComplete(handler: CommandStartHandler) {
    this.eventBus.on('/command/complete/fromuser', handler)
  }

  public offAnyCommandComplete(handler: CommandStartHandler) {
    this.eventBus.on('/command/complete/fromuser', handler)
  }

  public onCommandStart(
    splitId: string,
    splitHandler: CommandStartHandler,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.onCommand('start', splitId, splitHandler, tabId, tabHandler)
  }

  public onceCommandStarts(tabId: string, handler: CommandStartHandler): void {
    this.eventBus.once(`/command/start/fromuser/${tabId}`, handler)
  }

  private onResponseType(
    responseType: 'ScalarResponse' | 'MultiModalResponse' | 'NavResponse',
    splitId: string,
    splitHandler: CommandCompleteHandler,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.eventBus.on(`/command/complete/fromuser/${responseType}/${splitId}`, splitHandler)

    if (tabId) {
      this.eventBus.on(`/command/complete/fromuser/${responseType}/${tabId}`, tabHandler)
    }
  }

  private offResponseType(
    responseType: 'ScalarResponse' | 'MultiModalResponse' | 'NavResponse',
    splitId: string,
    splitHandler: CommandCompleteHandler,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.eventBus.off(`/command/complete/fromuser/${responseType}/${splitId}`, splitHandler)

    if (tabId) {
      this.eventBus.off(`/command/complete/fromuser/${responseType}/${tabId}`, tabHandler)
    }
  }

  public onScalarResponse(
    splitId: string,
    splitHandler: CommandCompleteHandler<ScalarResponse>,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.onResponseType('ScalarResponse', splitId, splitHandler, tabId, tabHandler)
  }

  public offScalarResponse(
    splitId: string,
    splitHandler: CommandCompleteHandler<ScalarResponse>,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.offResponseType('ScalarResponse', splitId, splitHandler, tabId, tabHandler)
  }

  public onMultiModalResponse(
    tabId: string,
    handler: CommandCompleteHandler<MultiModalResponse, 'MultiModalResponse'>
  ): void {
    this.onResponseType('MultiModalResponse', tabId, handler)
  }

  public offMultiModalResponse(
    tabId: string,
    handler: CommandCompleteHandler<MultiModalResponse, 'MultiModalResponse'>
  ): void {
    this.offResponseType('MultiModalResponse', tabId, handler)
  }

  public onNavResponse(tabId: string, handler: CommandCompleteHandler<NavResponse, 'NavResponse'>): void {
    this.onResponseType('NavResponse', tabId, handler)
  }

  public offNavResponse(tabId: string, handler: CommandCompleteHandler<NavResponse, 'NavResponse'>): void {
    this.offResponseType('NavResponse', tabId, handler)
  }

  public onCommandComplete(
    splitId: string,
    splitHandler: CommandCompleteHandler,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.onCommand('complete', splitId, splitHandler, tabId, tabHandler)
  }

  public offCommandStart(
    splitId: string,
    splitHandler: CommandStartHandler,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.offCommand('start', splitId, splitHandler, tabId, tabHandler)
  }

  public offCommandComplete(
    splitId: string,
    splitHandler: CommandCompleteHandler,
    tabId?: string,
    tabHandler = splitHandler
  ): void {
    this.offCommand('complete', splitId, splitHandler, tabId, tabHandler)
  }

  public onWithTabId(
    channel: '/tab/offline' | '/tab/close/request',
    tabId: string,
    listener: (tabId: string, tab: Tab) => void
  ): void {
    this.eventBus.on(`${channel}/${tabId}`, listener)
  }

  public offWithTabId(
    channel: '/tab/offline' | '/tab/close/request',
    tabId: string,
    listener: (tabId: string, tab: Tab) => void
  ): void {
    this.eventBus.off(`${channel}/${tabId}`, listener)
  }

  public onceWithTabId(
    channel: '/tab/offline' | '/tab/close/request',
    tabId: string,
    listener: (tabId: string, tab: Tab) => void
  ): void {
    this.eventBus.once(`${channel}/${tabId}`, listener)
  }

  public once(channel: '/tab/new', listener: (tab: Tab) => void): void
  public once(channel: string, listener: any) {
    return this.eventBus.once(channel, listener)
  }
}

class EventBus extends ReadEventBus {}
export const eventBus = new EventBus()

/**
 * Hook an event listener up to the family of standard user
 * interaction events.
 *
 */
export function wireToStandardEvents(listener: () => void) {
  eventBus.on('/tab/new', listener)
  eventBus.on('/tab/switch/request', listener)
  eventBus.onAnyCommandComplete(listener)
}

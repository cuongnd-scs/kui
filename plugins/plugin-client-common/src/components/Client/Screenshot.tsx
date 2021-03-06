/*
 * Copyright 2020 IBM Corporation
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

import * as React from 'react'
import { Event, NativeImage } from 'electron'
import { i18n, eventChannelUnsafe } from '@kui-shell/core'
import Alert from '../spi/Alert'
import { Button } from 'carbon-components-react'

import '../../../web/css/static/Screenshot.scss'

const strings = i18n('plugin-client-common', 'screenshot')

type Props = {}

interface State {
  /** if the user has clicked the screenshot button an even or odd number of times */
  isActive: boolean

  /** content of captured image */
  captured?: NativeImage

  /** remember location of user's Desktop */
  desktop?: string
}

/** fill to two digits */
const fill = (n: number) => (n < 10 ? `0${n}` : n)

/** format the date; e.g. 2018-03-27 */
const dateString = (ts: Date) => `${ts.getUTCFullYear()}-${fill(1 + ts.getUTCMonth())}-${fill(ts.getUTCDate())}`

/** format the time; e.g. 11.36.54 AM */
const timeString = (ts: Date) => ts.toLocaleTimeString('en-us').replace(/:/g, '.')

export default class Screenshot extends React.PureComponent<Props, State> {
  private overlayCleaner: () => void
  private cleaners: (() => void)[] = []

  /** @see https://github.com/IBM/kui/issues/4170 */
  private renderOverlayTransparent = false
  private toggleOverlayTransparency: () => void

  public constructor(props: Props) {
    super(props)

    this.state = {
      isActive: false
    }

    eventChannelUnsafe.on('/screenshot/element', (element: HTMLElement) => {
      this.onClickScreenshotRegion(element)
    })
  }

  /** Transition back to a normal state, where are aren't ready to capture a screenshot */
  private deactivate() {
    if (this.cleaners) {
      this.cleaners.forEach(cleaner => cleaner())
      this.cleaners = undefined
    }

    if (this.overlayCleaner) {
      this.overlayCleaner()
      this.overlayCleaner = undefined
    }
  }

  /** User has clicked on a region to be captured */
  private onClickScreenshotRegion(element: Element) {
    if (this.toggleOverlayTransparency) {
      this.renderOverlayTransparent = true
      this.toggleOverlayTransparency()
    }
    setTimeout(async () => {
      try {
        await this.captureRegion(element)
        this.deactivate()
      } finally {
        this.renderOverlayTransparent = false
      }
    }, 120)
  }

  /**
   * This is the actual work to screenshot a given region of the
   * screen defined by the extent of the given dom.
   *
   */
  private captureRegion(element: Element) {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        const { ipcRenderer, nativeImage, remote } = await import('electron')
        const { app } = remote

        const domRect = element.getBoundingClientRect()
        const rect = {
          x: Math.round(domRect.left),
          y: Math.round(domRect.top),
          width: Math.round(domRect.width),
          height: Math.round(domRect.height)
        }

        // capture a screenshot
        const listener = (event: Event, buf: Buffer) => {
          try {
            document.body.classList.remove('no-tooltips-anywhere')

            if (!buf) {
              console.error('Unable to capture screenshot')
            } else {
              this.setState({ captured: nativeImage.createFromBuffer(buf), desktop: app.getPath('desktop') })
            }

            // done!
            resolve()
          } catch (err) {
            reject(err)
          }
        }

        //
        // register our listener, and tell the main process to get
        // started (in that order!)
        //
        ipcRenderer.once('capture-page-to-clipboard-done', listener)
        ipcRenderer.send('capture-page-to-clipboard', remote.getCurrentWebContents().id, rect)
      } catch (err) {
        reject(err)
      }
    })
  }

  /** Transition to a state where we are ready to capture a screenshot */
  private activate() {
    this.cleaners = []
    const elements = document.querySelectorAll('.kui--screenshotable')
    for (let idx = 0; idx < elements.length; idx++) {
      this.cleaners.push(this.wrap(elements[idx]))
    }

    const onKeyUp = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        evt.stopPropagation()
        this.deactivate()
        this.setState({ isActive: false })
      }
    }
    document.body.addEventListener('keyup', onKeyUp)
    this.cleaners.push(() => document.body.removeEventListener('keyup', onKeyUp))
  }

  /** Number to css "px" */
  private px(N: number) {
    return `${N}px`
  }

  /** Wrap a given dom Element so that it is screenshotable */
  private wrap(element: Element) {
    const onMouseOver = (evt: MouseEvent) => {
      evt.stopPropagation()

      if (this.overlayCleaner) {
        this.overlayCleaner()
      }

      const pos = element.getBoundingClientRect()
      const overlay = document.createElement('div')
      overlay.id = 'kui--screenshot-overlay'
      overlay.style.left = this.px(pos.left)
      overlay.style.top = this.px(pos.top)
      overlay.style.width = this.px(pos.width)
      overlay.style.height = this.px(pos.height)
      document.body.appendChild(overlay)
      element.classList.add('kui--screenshot-hover')
      if (this.renderOverlayTransparent) {
        overlay.classList.add('kui--screenshot-overlay-transparent')
      }

      const onMouseOut = () => {
        overlay.remove()
        element.classList.remove('kui--screenshot-hover')
      }
      overlay.addEventListener('mouseout', onMouseOut, { once: true })

      overlay.addEventListener(
        'click',
        () => {
          onMouseOut()
          this.onClickScreenshotRegion(element)
        },
        { once: true }
      )

      this.overlayCleaner = onMouseOut
      this.toggleOverlayTransparency = () => {
        overlay.classList.toggle('kui--screenshot-overlay-transparent')
      }
    }

    element.addEventListener('mouseover', onMouseOver)

    return () => {
      element.removeEventListener('mouseover', onMouseOver)
    }
  }

  /** User has clicked on the Save to Desktop button */
  private async saveToDisk() {
    const { join } = await import('path')
    const { remote, shell } = await import('electron')

    const ts = new Date()
    const filename = `Screen Shot ${dateString(ts)} ${timeString(ts)}.png`
    const location = join(this.state.desktop, filename)

    remote.require('fs').writeFile(location, this.state.captured.toPNG(), async () => {
      console.log(`screenshot saved to ${location}`)

      try {
        shell.showItemInFolder(location)
      } catch (err) {
        console.error('error opening screenshot file')
      }
    })
  }

  /** Inside of the ToastNotification, render a Save to Desktop button */
  private saveToDiskButton() {
    return (
      <div className="bx--btn-set">
        <Button
          href="#"
          size="small"
          kind="secondary"
          onClick={() => this.setState({ isActive: false, captured: undefined })}
        >
          {strings('Done')}
        </Button>
        <Button href="#" size="small" className="screenshot-save-button" onClick={this.saveToDisk.bind(this)}>
          {strings('Save to desktop')}
        </Button>
      </div>
    )
  }

  private closeNotification() {
    this.setState({ isActive: false, captured: undefined })
  }

  /** Render a ToastNotification to tell the user what we captured */
  private notification() {
    if (this.state && this.state.captured) {
      const timeout = 100000 * 1000
      const alert = {
        type: 'success' as const,
        title: strings('Screenshot'),
        body: strings('Successfully captured a screenshot to the clipboard')
      }

      return (
        <Alert
          id="screenshot-captured"
          timeout={timeout}
          alert={alert}
          className="kui--inverted-color-context"
          onCloseButtonClick={this.closeNotification.bind(this)}
        >
          <div className="flex-layout">
            <img src={this.state.captured.toDataURL()} className="screenshot-image" />
          </div>
          <div className="kui--screenshot-captured-bottom-message">{this.saveToDiskButton()}</div>
        </Alert>
      )
    }
  }

  /** User has clicked on the screenshot button */
  private onScreenshotButtonClick(evt: MouseEvent) {
    evt.preventDefault()

    this.setState(curState => {
      const isActive = !curState.isActive

      if (!isActive) {
        this.deactivate()
      } else {
        this.activate()
      }

      return { isActive, captured: undefined }
    })
  }

  /** Render the screenshot button */
  /* private button() {
    const active = this.state.isActive
    const onClick = this.onScreenshotButtonClick.bind(this)

    return (
      <a
        href="#"
        tabIndex={-1}
        className="kui--tab-navigatable clickable kui--screenshot-button"
        onClick={onClick}
        data-active={active}
      >
        {active ? (
          <Icons icon="ScreenshotInProgress" onMouseDown={evt => evt.preventDefault()} />
        ) : (
          <Icons icon="Screenshot" onMouseDown={evt => evt.preventDefault()} />
        )}
      </a>
    )
  } */

  public render() {
    return (
      <React.Fragment>
        {this.notification()}
        {/* this.button() */}
      </React.Fragment>
    )
  }
}

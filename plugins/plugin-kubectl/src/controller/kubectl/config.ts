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

import { Arguments, Registrar, eventChannelUnsafe } from '@kui-shell/core'

import flags from './flags'
import { doExecWithPty } from './exec'
import { KubeOptions } from './options'
import commandPrefix from '../command-prefix'

const CHANNEL = '/kubectl/config/change'
type Handler = (args: Arguments<KubeOptions>) => void

const mutators = [
  'delete-cluster',
  'delete-context',
  'rename-context',
  'set',
  'set-cluster',
  'set-context',
  'set-credentials',
  'unset',
  'use-context'
]

export function onKubectlConfigChangeEvents(handler: Handler) {
  eventChannelUnsafe.on(CHANNEL, handler)
}

export function offKubectlConfigChangeEvents(handler: Handler) {
  eventChannelUnsafe.off(CHANNEL, handler)
}

/**
 * Here, we conservatively broadcoast that the kubectl config *may*
 * have changed.
 *
 */
async function doConfig(args: Arguments<KubeOptions>) {
  const response = await doExecWithPty(args)
  eventChannelUnsafe.emit(CHANNEL, args)
  return response
}

export function register(registrar: Registrar, cmd: string) {
  mutators.forEach(verb => {
    registrar.listen(`/${commandPrefix}/${cmd}/config/${verb}`, doConfig, flags)
  })
}

/**
 * Register the commands
 *
 */
export default (registrar: Registrar) => {
  register(registrar, 'kubectl')
  register(registrar, 'k')
}

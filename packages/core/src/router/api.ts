import { join } from 'path'
import { createUnrouted, get, post, prefix, redirect, setStatusCode, useParams, useQuery } from '@unrouted/core'
import fs from 'fs-extra'
import launch from 'launch-editor'
import { presetNode, serve } from '@unrouted/preset-node'
import { presetApi } from '@unrouted/preset-api'
import type { App } from 'h3'
import { defineEventHandler } from 'h3'
import { useUnlighthouse } from '../unlighthouse'
import { useLogger } from '../logger'
import { createScanMeta } from '../data'

/**
 * The API layer of unlighthouse.
 *
 * Internally, this uses unrouted which provides an elegant and batteries-packed solution.
 */
export const createApi = async(h3: App) => {
  const logger = useLogger()
  const { ws, resolvedConfig, runtimeSettings, hooks } = useUnlighthouse()
  const useReport = () => {
    const { worker } = useUnlighthouse()

    const { id } = useParams<{ id: string }>()
    return worker.findReport(id)
  }

  const { app, setup } = await createUnrouted({
    name: 'unlighthouse-api',
    debug: resolvedConfig.debug,
    prefix: resolvedConfig.routerPrefix,
    app: h3,
    hooks: {
      // @ts-expect-error untyped
      'serve:before-route': () => {
        // before we serve a route to the user we trigger a hook to let unlighthouse context know
        return hooks.callHook('visited-client')
      },
    },
    presets: [
      presetApi(),
      presetNode({
        generateTypes: false,
      }),
    ],
  })

  await setup(() => {
    // handle typos
    redirect('/__lighthouse/', resolvedConfig.routerPrefix)

    prefix('/api', () => {
      prefix('/reports', () => {
        post('/rescan', () => {
          const { worker } = useUnlighthouse()

          const reports = [...worker.routeReports.values()]
          logger.info(`Doing site rescan, clearing ${reports.length} reports.`)
          worker.routeReports.clear()
          reports.forEach((route) => {
            const dir = route.artifactPath
            if (fs.existsSync(dir))
              fs.rmSync(dir, { recursive: true })
          })
          worker.queueRoutes(reports.map(report => report.route))
          return true
        })

        post('/:id/rescan', () => {
          const report = useReport()
          const { worker } = useUnlighthouse()

          if (report)
            worker.requeueReport(report)
        })
      })

      get('__launch', () => {
        const { file } = useQuery<{ file: string }>()
        if (!file) {
          setStatusCode(400)
          return false
        }
        const path = file.replace(resolvedConfig.root, '')
        const resolved = join(resolvedConfig.root, path)
        logger.info(`Launching file in editor: \`${path}\``)
        launch(resolved)
      })

      get('ws', defineEventHandler(event => ws.serve(event.req)))

      get('reports', () => {
        const { worker } = useUnlighthouse()

        return worker.reports().filter(r => r.tasks.inspectHtmlTask === 'completed')
      })

      get('scan-meta', () => createScanMeta())
    })

    serve('/', runtimeSettings.generatedClientPath)
  })

  return app
}

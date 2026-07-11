import babelPlugin from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import resolvePlugin from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { styleText } from 'node:util'
import postcssPlugin from 'rollup-plugin-postcss'
import { readPackageUp } from 'read-package-up'
import { defineConfig } from 'rollup'
import userscript from 'rollup-plugin-userscript'

const { packageJson } = await readPackageUp()
const extensions = ['.ts', '.tsx', '.mjs', '.js', '.jsx']

const bindHost = '127.0.0.1'
const publicHost = 'localhost'
const port = Number(process.env.PORT || 8080)
const distDirectory = resolve('dist')

let devServer

export default defineConfig(
  Object.entries({
    'hb-key-exporter': 'src/index.ts',
  }).map(([name, entry]) => ({
    input: entry,
    plugins: [
      postcssPlugin({
        inject: false,
        minimize: true,
      }),
      babelPlugin({
        babelHelpers: 'runtime',
        plugins: [import.meta.resolve('@babel/plugin-transform-runtime')],
        exclude: 'node_modules/**',
        extensions,
      }),
      replacePlugin({
        values: {
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        },
        preventAssignment: true,
      }),
      resolvePlugin({ browser: false, extensions }),
      commonjsPlugin(),
      jsonPlugin(),
      userscript((meta) =>
        meta
          .replace('process.env.AUTHOR', packageJson.author.name)
          .replace('process.env.VERSION', packageJson.version)
          .replace('process.env.DESCRIPTION', packageJson.description)
          .replace(
            'process.env.DOWNLOAD_URL',
            process.env.NODE_ENV === 'production' ? packageJson.downloadURL : ''
          )
      ),
      process.env.ROLLUP_WATCH && {
        name: 'serve',

        async writeBundle() {
          if (!devServer) {
            devServer = createServer(async (request, response) => {
              const pathname = new URL(request.url || '/', `http://${publicHost}:${port}`).pathname

              if (pathname === '/') {
                response.writeHead(200, {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-store',
                })
                response.end('<a href="/hb-key-exporter.user.js">hb-key-exporter.user.js</a>')
                return
              }

              const filePath = resolve(distDirectory, `.${pathname}`)
              const relativePath = relative(distDirectory, filePath)

              if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
                response.writeHead(403)
                response.end('Forbidden')
                return
              }

              try {
                const data = await readFile(filePath)
                const extension = extname(filePath)
                const contentType =
                  extension === '.js'
                    ? 'application/javascript; charset=utf-8'
                    : extension === '.html'
                      ? 'text/html; charset=utf-8'
                      : 'application/octet-stream'

                response.writeHead(200, {
                  'Content-Type': contentType,
                  'Cache-Control': 'no-store',
                })
                response.end(data)
              } catch {
                response.writeHead(404)
                response.end('Not found')
              }
            })

            await new Promise((resolveListen, rejectListen) => {
              const handleError = (error) => {
                devServer = undefined
                rejectListen(error)
              }

              devServer.once('error', handleError)
              devServer.listen(port, bindHost, () => {
                devServer.off('error', handleError)
                resolveListen()
              })
            })
          }

          const url = `http://${publicHost}:${port}/hb-key-exporter.user.js`
          const displayedUrl = styleText(['reset', 'bold'], url, {
            stream: process.stderr,
          })

          console.log()
          this.info(`Userscript: ${displayedUrl}`)
        },

        closeWatcher() {
          if (!devServer) return

          const server = devServer
          devServer = undefined

          return new Promise((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error)
              } else {
                resolveClose()
              }
            })
          })
        },
      },
    ].filter(Boolean),
    external: defineExternal([
      'lz-string',
      'datatables.net-dt',
      'solid-js',
      'solid-js/web',
      '@violentmonkey/ui',
      '@violentmonkey/dom',
    ]),
    output: {
      format: 'iife',
      file: `dist/${name}.user.js`,
      globals: {
        'lz-string': 'LZString',
        'datatables.net-dt': 'DataTable',
        'solid-js': 'VM.solid',
        'solid-js/web': 'VM.solid.web',
        '@violentmonkey/dom': 'VM',
        '@violentmonkey/ui': 'VM',
      },
      indent: false,
    },
  }))
)

function defineExternal(externals) {
  return (id) =>
    externals.some((pattern) => {
      if (typeof pattern === 'function') return pattern(id)
      if (pattern && typeof pattern.test === 'function') return pattern.test(id)
      if (isAbsolute(pattern)) return !relative(pattern, resolve(id)).startsWith('..')
      return id === pattern || id.startsWith(pattern + '/')
    })
}

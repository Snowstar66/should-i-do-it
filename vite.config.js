/* global process */

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const createNodeResponseAdapter = (response, next) => {
  let statusCode = 200

  response.status = (code) => {
    statusCode = code
    response.statusCode = code
    return response
  }

  response.send = (payload) => {
    response.statusCode = statusCode
    response.end(payload)
  }

  response.json = (payload) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.statusCode = statusCode
    response.end(JSON.stringify(payload))
  }

  response.error = next

  return response
}

const createLocalApiPlugin = () => ({
  name: 'local-api-routes',
  configureServer(server) {
    server.middlewares.use('/api/world', async (request, response, next) => {
      try {
        const { default: handler } = await import('./api/world.js')
        const adaptedResponse = createNodeResponseAdapter(response, next)

        await handler(request, adaptedResponse)
      } catch (error) {
        next(error)
      }
    })
  }
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  Object.assign(process.env, env)

  return {
    plugins: [react(), createLocalApiPlugin()]
  }
})

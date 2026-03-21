/* global process */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const PROJECT_ROOT = process.cwd()

const createNodeRequestAdapter = (request) => {
  const url = new URL(request.originalUrl ?? request.url ?? '/', 'http://localhost')
  const query = {}

  url.searchParams.forEach((value, key) => {
    if (query[key] === undefined) {
      query[key] = value
      return
    }

    query[key] = Array.isArray(query[key])
      ? [...query[key], value]
      : [query[key], value]
  })

  request.query = query

  return request
}

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
    const handleApiRoute = async (request, response, next, handlerPath) => {
      try {
        const handlerUrl = pathToFileURL(resolve(PROJECT_ROOT, handlerPath)).href
        const { default: handler } = await import(handlerUrl)
        const adaptedRequest = createNodeRequestAdapter(request)
        const adaptedResponse = createNodeResponseAdapter(response, next)

        await handler(adaptedRequest, adaptedResponse)
      } catch (error) {
        next(error)
      }
    }

    server.middlewares.use('/api/world', async (request, response, next) => {
      await handleApiRoute(request, response, next, 'api/world.js')
    })

    server.middlewares.use('/api/movie', async (request, response, next) => {
      await handleApiRoute(request, response, next, 'api/movie.js')
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

/* global process */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const OIL_PRICE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=1d'
const NEWS_FEED_URL = 'https://feeds.bbci.co.uk/news/rss.xml'
const execFileAsync = promisify(execFile)

const decodeHtml = (value) => String(value ?? '')
  .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .trim()

const sendJson = (response, statusCode, payload) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.status(statusCode).send(JSON.stringify(payload))
}

const fetchTextWithCurl = async (url) => {
  const { stdout } = await execFileAsync('curl.exe', [
    '-L',
    '-A',
    'Maxipedia/1.0',
    url
  ], {
    maxBuffer: 1024 * 1024 * 2
  })

  return stdout
}

const fetchBrentOilPrice = async () => {
  const response = await fetch(OIL_PRICE_URL)

  if (!response.ok) {
    throw new Error(`Oil price request failed (${response.status})`)
  }

  const payload = await response.json()
  const chart = payload?.chart?.result?.[0]
  const quote = chart?.indicators?.quote?.[0]
  const timestamp = chart?.timestamp?.[0]
  const closeValue = Number(quote?.close?.[0] ?? chart?.meta?.regularMarketPrice)
  const openValue = Number(quote?.open?.[0])
  const highValue = Number(quote?.high?.[0])
  const lowValue = Number(quote?.low?.[0])
  const date = timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 10) : ''

  return {
    label: 'Brentolja',
    date,
    open: Number.isFinite(openValue) ? openValue : null,
    high: Number.isFinite(highValue) ? highValue : null,
    low: Number.isFinite(lowValue) ? lowValue : null,
    usdPerBarrel: Number.isFinite(closeValue) ? closeValue : null
  }
}

const fetchNewsFlash = async () => {
  let xml = ''

  try {
    const response = await fetch(NEWS_FEED_URL, {
      headers: {
        'User-Agent': 'Maxipedia/1.0',
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9'
      }
    })

    if (!response.ok) {
      throw new Error(`News feed request failed (${response.status})`)
    }

    xml = await response.text()
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error
    }

    xml = await fetchTextWithCurl(NEWS_FEED_URL)
  }

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]

  return items.slice(0, 12).map(([, itemXml]) => {
    const title = decodeHtml(itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '')
    const link = decodeHtml(itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '')

    return {
      title,
      link,
      source: 'BBC News'
    }
  }).filter((item) => item.title && item.link)
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      error: 'Only GET is supported for this endpoint.'
    })
    return
  }

  try {
    const [oilPriceResult, newsResult] = await Promise.allSettled([
      fetchBrentOilPrice(),
      fetchNewsFlash()
    ])

    const oilPrice = oilPriceResult.status === 'fulfilled' ? oilPriceResult.value : null
    const news = newsResult.status === 'fulfilled' ? newsResult.value : []

    sendJson(response, 200, {
      ok: Boolean(oilPrice || news.length > 0),
      oilPrice,
      news
    })
  } catch (error) {
    console.error('World endpoint error:', error)
    sendJson(response, 500, {
      ok: false,
      error: 'Could not fetch world highlights right now.'
    })
  }
}

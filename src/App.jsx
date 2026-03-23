import { useState, useEffect, useRef } from 'react'

const LOCAL_OMDB_API_KEY = import.meta.env.VITE_OMDB_API_KEY?.trim()
const LOCAL_TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY?.trim()
const SPOT_PRICE_AREAS = ['SE1', 'SE2', 'SE3', 'SE4']
const SPOT_PRICE_TIME_ZONE = 'Europe/Stockholm'
const SPOT_PRICE_API_BASE_URL = 'https://www.elprisetjustnu.se/api/v1/prices'
const EXCHANGE_RATE_API_BASE_URL = 'https://api.frankfurter.dev/v1'
const WEATHER_API_BASE_URL = 'https://api.open-meteo.com/v1/forecast'
const MOVIE_API_PATH = '/api/movie'
const WORLD_API_PATH = '/api/world'
const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3'
const MOVIE_STREAMING_REGION = 'SE'
const WIKIPEDIA_SEARCH_LANGUAGES = ['sv', 'en']
const MOVIE_MATCH_SCORE_THRESHOLD = 72
const MOVIE_HINT_KEYWORDS = ['film', 'movie', 'filmer', 'movies', 'adventure film', 'fantasy film', 'action film']
const EMPTY_MOVIE_PROVIDERS = {
  flatrate: [],
  free: [],
  ads: [],
  rent: [],
  buy: []
}
const MOVIE_PROVIDER_SECTIONS = [
  { key: 'flatrate', label: 'Streamas hos' },
  { key: 'free', label: 'Gratis hos' },
  { key: 'ads', label: 'Med reklam hos' },
  { key: 'rent', label: 'Hyr hos' },
  { key: 'buy', label: 'Kop hos' }
]
const MOVIE_CLIENT_CACHE_TTL_MS = 1000 * 60 * 10
const APP_SECTION_MAX_WIDTH = '900px'
const movieClientCache = new Map()
const WEATHER_LOCATIONS = [
  { key: 'ostersund', name: 'Östersund', latitude: 63.1792, longitude: 14.6357 },
  { key: 'marbella', name: 'Marbella', latitude: 36.5101, longitude: -4.8824 }
]
const HISTORY_DAY_OFFSETS = [-6, -5, -4, -3, -2, -1, 0]

const fetchJsonp = (url) => new Promise((resolve, reject) => {
  const callbackName = `jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const script = document.createElement('script')
  const separator = url.includes('?') ? '&' : '?'

  const cleanup = () => {
    delete window[callbackName]
    script.remove()
  }

  const timeoutId = window.setTimeout(() => {
    cleanup()
    reject(new Error(`Request timed out for ${url}`))
  }, 10000)

  window[callbackName] = (data) => {
    window.clearTimeout(timeoutId)
    cleanup()
    resolve(data)
  }

  script.src = `${url}${separator}callback=${callbackName}`
  script.async = true
  script.onerror = () => {
    window.clearTimeout(timeoutId)
    cleanup()
    reject(new Error(`JSONP request failed for ${url}`))
  }

  document.head.appendChild(script)
})

const stripHtmlTags = (value) => String(value ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const getShortText = (value, maxLength = 220) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()

  if (!text) {
    return ''
  }

  const sentences = text.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? []
  const shortBySentence = sentences.reduce((result, sentence) => {
    if (!sentence) {
      return result
    }

    const candidate = result ? `${result} ${sentence}` : sentence

    return candidate.length <= maxLength ? candidate : result
  }, '')

  if (shortBySentence) {
    return shortBySentence
  }

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`
}

const fetchJson = async (url) => {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return response.json()
}

const searchWikipediaPages = async (query, language, limit = 5) => {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit)
  })
  const payload = await fetchJson(`https://${language}.wikipedia.org/w/rest.php/v1/search/page?${params.toString()}`)

  return Array.isArray(payload?.pages) ? payload.pages : []
}

const fetchWikipediaPageSummary = async (pageKey, language) => {
  const encodedPageKey = encodeURIComponent(pageKey)

  return fetchJson(`https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodedPageKey}`)
}

const fetchWikipediaLanguageLink = async (title, fromLanguage, toLanguage) => {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'langlinks',
    titles: title,
    lllang: toLanguage,
    format: 'json',
    origin: '*'
  })
  const payload = await fetchJson(`https://${fromLanguage}.wikipedia.org/w/api.php?${params.toString()}`)
  const firstPage = Object.values(payload?.query?.pages ?? {})[0]

  return firstPage?.langlinks?.[0]?.['*'] ?? null
}

const getMovieYearNumber = (value) => {
  const match = String(value ?? '').match(/\d{4}/)

  return match ? Number(match[0]) : null
}

const normalizeMovieTitle = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const getClientMovieCacheValue = (key) => {
  const cachedEntry = movieClientCache.get(key)

  if (!cachedEntry) {
    return null
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    movieClientCache.delete(key)
    return null
  }

  return cachedEntry.value
}

const setClientMovieCacheValue = (key, value) => {
  movieClientCache.set(key, {
    value,
    expiresAt: Date.now() + MOVIE_CLIENT_CACHE_TTL_MS
  })
}

const getUniqueProviderNames = (providers) => [
  ...new Set(
    (providers ?? [])
      .map((provider) => provider?.provider_name)
      .filter(Boolean)
  )
]

const getMovieSearchVariants = (title) => {
  const cleanedTitle = String(title ?? '').replace(/\s+/g, ' ').trim()
  const shortenedTitle = cleanedTitle.split(/[:(|-]/)[0]?.trim()
  const normalizedWords = normalizeMovieTitle(cleanedTitle)
    .split(' ')
    .filter((word) => word.length > 2)
  const keywordQuery = normalizedWords
    .slice(0, 3)
    .join(' ')
  const longestSingleWords = [...normalizedWords]
    .sort((left, right) => right.length - left.length)
    .slice(0, 3)
  const shortestWord = [...normalizedWords].sort((left, right) => left.length - right.length)[0]
  const withoutShortestWord = normalizedWords.filter((word, index) => {
    const shortestIndex = normalizedWords.indexOf(shortestWord)

    return shortestWord && normalizedWords.length > 1 ? index !== shortestIndex : true
  }).join(' ')

  return [...new Set([
    cleanedTitle,
    shortenedTitle,
    normalizedWords.join(' '),
    keywordQuery,
    withoutShortestWord,
    ...longestSingleWords
  ].filter((variant) => variant && variant.length >= 3))]
}

const getLevenshteinDistance = (left, right) => {
  const source = normalizeMovieTitle(left)
  const target = normalizeMovieTitle(right)

  if (!source) {
    return target.length
  }

  if (!target) {
    return source.length
  }

  const rows = Array.from({ length: source.length + 1 }, (_, index) => [index])
  const firstRow = Array.from({ length: target.length + 1 }, (_, index) => index)

  rows[0] = firstRow

  for (let rowIndex = 1; rowIndex <= source.length; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= target.length; columnIndex += 1) {
      const substitutionCost = source[rowIndex - 1] === target[columnIndex - 1] ? 0 : 1

      rows[rowIndex][columnIndex] = Math.min(
        rows[rowIndex - 1][columnIndex] + 1,
        rows[rowIndex][columnIndex - 1] + 1,
        rows[rowIndex - 1][columnIndex - 1] + substitutionCost
      )
    }
  }

  return rows[source.length][target.length]
}

const getMovieTitleMatchScore = (candidateTitle, queryTitle) => {
  const normalizedCandidate = normalizeMovieTitle(candidateTitle)
  const normalizedQuery = normalizeMovieTitle(queryTitle)

  if (!normalizedCandidate || !normalizedQuery) {
    return 0
  }

  const candidateWords = normalizedCandidate.split(' ').filter(Boolean)
  const queryWords = normalizedQuery.split(' ').filter(Boolean)
  const sharedWordCount = queryWords.filter((word) => candidateWords.includes(word)).length
  const levenshteinDistance = getLevenshteinDistance(normalizedCandidate, normalizedQuery)

  let score = Math.max(0, 60 - levenshteinDistance * 6)

  if (normalizedCandidate === normalizedQuery) {
    score += 180
  }

  if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
    score += 90
  }

  score += sharedWordCount * 24
  score += Math.round((sharedWordCount / Math.max(queryWords.length, 1)) * 30)

  return score
}

const isMovieLikeWikipediaPage = (page, summary) => {
  const normalizedText = normalizeMovieTitle([
    page?.title,
    page?.description,
    stripHtmlTags(page?.excerpt),
    summary?.description,
    summary?.extract
  ].filter(Boolean).join(' '))

  return MOVIE_HINT_KEYWORDS.some((keyword) => normalizedText.includes(normalizeMovieTitle(keyword)))
}

const mapOmdbMovieResponse = (response, fallbackTitle) => ({
  title: response?.Title ?? fallbackTitle,
  year: response?.Year ?? '',
  plot: response?.Plot && response.Plot !== 'N/A' ? response.Plot : '',
  genre: response?.Genre && response.Genre !== 'N/A' ? response.Genre : '',
  poster: response?.Poster && response.Poster !== 'N/A' ? response.Poster : '',
  imdbRating: response?.imdbRating && response.imdbRating !== 'N/A' ? response.imdbRating : null,
  rottenTomatoesRating: response?.Ratings?.find((rating) => rating?.Source === 'Rotten Tomatoes')?.Value ?? null
})

const findBestOmdbSearchCandidate = async (queryTitle, titleHints = [], maxVariants = 5) => {
  let bestMatch = null
  const searchVariants = [...new Set(titleHints.flatMap((titleHint) => getMovieSearchVariants(titleHint)))]
    .slice(0, maxVariants)

  for (const variant of searchVariants) {
    const searchParams = new URLSearchParams({
      apikey: LOCAL_OMDB_API_KEY,
      s: variant,
      type: 'movie',
      r: 'json'
    })
    const searchResponse = await fetchOmdbMovieResponse(searchParams)
    const searchResults = Array.isArray(searchResponse?.Search) ? searchResponse.Search : []
    const candidate = searchResults
      .map((result) => ({
        ...result,
        score: Math.max(
          getMovieTitleMatchScore(result?.Title, queryTitle),
          ...titleHints.map((titleHint) => getMovieTitleMatchScore(result?.Title, titleHint))
        )
      }))
      .filter((result) => result.score >= MOVIE_MATCH_SCORE_THRESHOLD)
      .sort((left, right) => right.score - left.score)[0] ?? null

    if (candidate && (!bestMatch || candidate.score > bestMatch.score)) {
      bestMatch = candidate
    }
  }

  return bestMatch
}

const fetchMovieDetailsFromServer = async (title, options = {}) => {
  try {
    const includeRelated = Boolean(options.includeRelated)
    const relatedOnly = Boolean(options.relatedOnly)
    const cacheKey = `${normalizeMovieTitle(title)}|related:${includeRelated ? 'yes' : 'no'}|only:${relatedOnly ? 'yes' : 'no'}`
    const cachedValue = getClientMovieCacheValue(cacheKey)

    if (cachedValue) {
      return cachedValue
    }

    const params = new URLSearchParams({ title })

    if (includeRelated) {
      params.set('includeRelated', '1')
    }

    if (relatedOnly) {
      params.set('relatedOnly', '1')
    }

    const response = await fetch(`${MOVIE_API_PATH}?${params.toString()}`)
    const contentType = response.headers.get('content-type') ?? ''

    if (!contentType.includes('application/json')) {
      return null
    }

    const payload = await response.json()

    if (payload?.ok && (payload?.movie || payload?.relatedMovies)) {
      setClientMovieCacheValue(cacheKey, payload)
    }

    return payload
  } catch (error) {
    console.error('Movie API endpoint unavailable, falling back to local browser fetch:', error)
    return null
  }
}

const fetchMovieTitleHintsFromWikipedia = async (title) => {
  const hints = []
  const queryVariants = getMovieSearchVariants(title).slice(0, 4)

  for (const language of WIKIPEDIA_SEARCH_LANGUAGES) {
    for (const queryVariant of queryVariants) {
      try {
        const pages = await searchWikipediaPages(queryVariant, language, 3)

        for (const page of pages) {
          const titleScore = Math.max(
            getMovieTitleMatchScore(page?.title, title),
            getMovieTitleMatchScore(page?.matched_title, title),
            getMovieTitleMatchScore(stripHtmlTags(page?.excerpt), title)
          )

          if (titleScore < MOVIE_MATCH_SCORE_THRESHOLD) {
            continue
          }

          let summary = null

          try {
            if (page?.key) {
              summary = await fetchWikipediaPageSummary(page.key, language)
            }
          } catch (error) {
            console.error(`Error fetching ${language} Wikipedia page summary for movie hints:`, error)
          }

          if (!isMovieLikeWikipediaPage(page, summary) && titleScore < MOVIE_MATCH_SCORE_THRESHOLD + 18) {
            continue
          }

          hints.push(page?.title, page?.matched_title, summary?.title)

          if (language === 'sv' && page?.title) {
            try {
              const englishTitle = await fetchWikipediaLanguageLink(page.title, 'sv', 'en')

              if (englishTitle) {
                hints.push(englishTitle)
              }
            } catch (error) {
              console.error('Error fetching English language link for Swedish movie title:', error)
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching movie title hints from ${language} Wikipedia:`, error)
      }
    }
  }

  return [...new Set(hints.filter(Boolean))].slice(0, 8)
}

const fetchOmdbMovieResponse = async (params) => {
  const response = await fetch(`https://www.omdbapi.com/?${params.toString()}`)

  if (!response.ok) {
    throw new Error(`OMDb request failed (${response.status})`)
  }

  const payload = await response.json()

  return payload?.Response === 'False' ? null : payload
}

const fetchMovieRatingsFromOmdb = async (title) => {
  if (!LOCAL_OMDB_API_KEY) {
    return null
  }

  const directExactMatchParams = new URLSearchParams({
    apikey: LOCAL_OMDB_API_KEY,
    t: title,
    type: 'movie',
    plot: 'short',
    r: 'json'
  })
  const directExactMatch = await fetchOmdbMovieResponse(directExactMatchParams)

  if (directExactMatch) {
    return mapOmdbMovieResponse(directExactMatch, title)
  }

  const directSearchMatch = await findBestOmdbSearchCandidate(title, [title], 3)

  if (directSearchMatch?.imdbID) {
    const detailsParams = new URLSearchParams({
      apikey: LOCAL_OMDB_API_KEY,
      i: directSearchMatch.imdbID,
      plot: 'short',
      r: 'json'
    })
    const detailsResponse = await fetchOmdbMovieResponse(detailsParams)

    return detailsResponse ? mapOmdbMovieResponse(detailsResponse, title) : null
  }

  const titleHints = [...new Set([
    title,
    ...(await fetchMovieTitleHintsFromWikipedia(title))
  ])]

  for (const titleHint of titleHints) {
    const exactMatchParams = new URLSearchParams({
      apikey: LOCAL_OMDB_API_KEY,
      t: titleHint,
      type: 'movie',
      plot: 'short',
      r: 'json'
    })
    const exactMatch = await fetchOmdbMovieResponse(exactMatchParams)

    if (exactMatch) {
      return mapOmdbMovieResponse(exactMatch, titleHint)
    }
  }

  const bestMatch = await findBestOmdbSearchCandidate(title, titleHints, 5)

  if (!bestMatch?.imdbID) {
    return null
  }

  const detailsParams = new URLSearchParams({
    apikey: LOCAL_OMDB_API_KEY,
    i: bestMatch.imdbID,
    plot: 'short',
    r: 'json'
  })
  const detailsResponse = await fetchOmdbMovieResponse(detailsParams)

  return detailsResponse ? mapOmdbMovieResponse(detailsResponse, title) : null
}

const getTmdbMovieMatchScore = (result, title, year) => {
  const titleScore = Math.max(
    getMovieTitleMatchScore(result?.title, title),
    getMovieTitleMatchScore(result?.original_title, title)
  )
  const yearScore = year && getMovieYearNumber(result?.release_date) === year ? 30 : 0

  return titleScore + yearScore
}

const pickBestTmdbMovieMatch = (results, title, year) => results
  .map((result) => ({
    ...result,
    score: getTmdbMovieMatchScore(result, title, year)
  }))
  .filter((result) => result.score >= MOVIE_MATCH_SCORE_THRESHOLD)
  .sort((left, right) => right.score - left.score)[0] ?? null

const fetchTmdbMovieSearchResults = async (title, year, language) => {
  const searchParams = new URLSearchParams({
    api_key: LOCAL_TMDB_API_KEY,
    query: title,
    include_adult: 'false',
    language
  })

  if (year) {
    searchParams.set('year', String(year))
  }

  const searchResponse = await fetchJsonp(`${TMDB_API_BASE_URL}/search/movie?${searchParams.toString()}`)

  return Array.isArray(searchResponse?.results) ? searchResponse.results : []
}

const fetchMovieStreamingFromTmdb = async (title, year) => {
  if (!LOCAL_TMDB_API_KEY) {
    return null
  }

  let matchedMovie = null

  for (const language of ['sv-SE', 'en-US']) {
    for (const variant of getMovieSearchVariants(title)) {
      const searchResults = await fetchTmdbMovieSearchResults(variant, year, language)
      const candidate = pickBestTmdbMovieMatch(searchResults, title, year)

      if (candidate && (!matchedMovie || candidate.score > matchedMovie.score)) {
        matchedMovie = candidate
      }
    }
  }

  if (!matchedMovie?.id) {
    return null
  }

  const providersParams = new URLSearchParams({
    api_key: LOCAL_TMDB_API_KEY
  })
  const providersResponse = await fetchJsonp(`${TMDB_API_BASE_URL}/movie/${matchedMovie.id}/watch/providers?${providersParams.toString()}`)
  const regionalProviders = providersResponse?.results?.[MOVIE_STREAMING_REGION]

  return {
    title: matchedMovie?.title ?? matchedMovie?.original_title ?? title,
    year: getMovieYearNumber(matchedMovie?.release_date),
    link: regionalProviders?.link ?? null,
    providers: {
      flatrate: getUniqueProviderNames(regionalProviders?.flatrate),
      free: getUniqueProviderNames(regionalProviders?.free),
      ads: getUniqueProviderNames(regionalProviders?.ads),
      rent: getUniqueProviderNames(regionalProviders?.rent),
      buy: getUniqueProviderNames(regionalProviders?.buy)
    }
  }
}

const getGeneralSearchQueries = (question) => {
  const cleanedQuestion = String(question ?? '')
    .replace(/[?!.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const stopWords = new Set([
    'vad', 'vem', 'vilken', 'vilket', 'vilka', 'hur', 'när', 'var', 'varför',
    'är', 'var', 'kan', 'ska', 'om', 'den', 'det', 'de', 'en', 'ett', 'på',
    'i', 'av', 'för', 'till', 'med', 'the', 'what', 'who', 'when', 'where',
    'why', 'how', 'is', 'are', 'was', 'were', 'do', 'does', 'did'
  ])
  const keywordQuery = cleanedQuestion
    .split(' ')
    .filter((word) => word && !stopWords.has(normalizeMovieTitle(word)))
    .join(' ')

  return [...new Set([cleanedQuestion, keywordQuery].filter((query) => query && query.length >= 2))]
}

const getGeneralPageMatchScore = (page, question) => Math.max(
  getMovieTitleMatchScore(page?.title, question),
  getMovieTitleMatchScore(page?.matched_title, question),
  getMovieTitleMatchScore(stripHtmlTags(page?.excerpt), question)
) + (page?.description ? 20 : 0)

const fetchShortAnswerFromWikipedia = async (question) => {
  for (const language of WIKIPEDIA_SEARCH_LANGUAGES) {
    for (const query of getGeneralSearchQueries(question)) {
      const pages = await searchWikipediaPages(query, language, 3)

      if (pages.length === 0) {
        continue
      }

      const bestPage = pages
        .map((page) => ({
          ...page,
          score: getGeneralPageMatchScore(page, question)
        }))
        .sort((left, right) => right.score - left.score)[0]

      if (!bestPage?.key) {
        continue
      }

      const summary = await fetchWikipediaPageSummary(bestPage.key, language)
      const shortExtract = getShortText(summary?.extract)
      const shortExcerpt = getShortText(stripHtmlTags(bestPage?.excerpt))
      const answerText = shortExtract || shortExcerpt || summary?.description || bestPage?.description

      if (!answerText) {
        continue
      }

      return {
        answer: answerText,
        sourceLabel: language === 'sv' ? 'Wikipedia' : 'English Wikipedia',
        imageUrl: summary?.thumbnail?.source ?? summary?.originalimage?.source ?? null,
        imageAlt: summary?.title ?? bestPage?.title ?? question
      }
    }
  }

  return null
}

const getSpotPriceDatePath = (dayOffset = 0) => {
  const [year, month, day] = getCalendarDateString(dayOffset, SPOT_PRICE_TIME_ZONE).split('-')

  return `${year}/${month}-${day}`
}

const calculateAverageSpotPriceInOre = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null
  }

  const valuesInOre = entries
    .map((entry) => Number(entry?.SEK_per_kWh) * 100)
    .filter((value) => Number.isFinite(value))

  if (valuesInOre.length === 0) {
    return null
  }

  const average = valuesInOre.reduce((sum, value) => sum + value, 0) / valuesInOre.length

  return Math.round(average * 100) / 100
}

const fetchSpotPriceAverageForDate = async (area, dayOffset) => {
  const datePath = getSpotPriceDatePath(dayOffset)
  const response = await fetch(`${SPOT_PRICE_API_BASE_URL}/${datePath}_${area}.json`)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Could not fetch spot price for ${area} (${response.status})`)
  }

  const entries = await response.json()

  return calculateAverageSpotPriceInOre(entries)
}

const getWeatherDescriptionFromCode = (code) => {
  const weatherDescriptions = {
    0: 'Klart',
    1: 'Mest klart',
    2: 'Växlande molnighet',
    3: 'Mulet',
    45: 'Dimma',
    48: 'Rimfrostdimma',
    51: 'Lätt duggregn',
    53: 'Duggregn',
    55: 'Tätt duggregn',
    56: 'Lätt underkylt duggregn',
    57: 'Underkylt duggregn',
    61: 'Lätt regn',
    63: 'Regn',
    65: 'Kraftigt regn',
    66: 'Lätt underkylt regn',
    67: 'Underkylt regn',
    71: 'Lätt snö',
    73: 'Snö',
    75: 'Kraftig snö',
    77: 'Snökorn',
    80: 'Lätta skurar',
    81: 'Regnskurar',
    82: 'Kraftiga skurar',
    85: 'Lätta snöbyar',
    86: 'Kraftiga snöbyar',
    95: 'Åska',
    96: 'Åska med hagel',
    99: 'Kraftig åska med hagel'
  }

  return weatherDescriptions[code] ?? 'Okänt väder'
}

const getWeatherSymbolFromCode = (code) => {
  if ([0, 1].includes(code)) {
    return '☀'
  }

  if ([2].includes(code)) {
    return '⛅'
  }

  if ([3, 45, 48].includes(code)) {
    return '☁'
  }

  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return '☂'
  }

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return '❄'
  }

  if ([95, 96, 99].includes(code)) {
    return '⚡'
  }

  return '•'
}

const formatNumber = (value, maximumFractionDigits = 1) => new Intl.NumberFormat('sv-SE', {
  minimumFractionDigits: 0,
  maximumFractionDigits
}).format(value)

const fetchWorldHighlightsFromServer = async () => {
  try {
    const response = await fetch(WORLD_API_PATH)
    const contentType = response.headers.get('content-type') ?? ''

    if (!contentType.includes('application/json')) {
      return null
    }

    return response.json()
  } catch (error) {
    console.error('World API endpoint unavailable, skipping oil and news flash:', error)
    return null
  }
}

const fetchExchangeRates = async () => {
  const mapExchangePayload = (payload) => {
    const eurToSek = Number(payload?.rates?.SEK)
    const eurToUsd = Number(payload?.rates?.USD)
    const eurToGbp = Number(payload?.rates?.GBP)
    const usdToSek = eurToSek && eurToUsd ? eurToSek / eurToUsd : null
    const gbpToSek = eurToSek && eurToGbp ? eurToSek / eurToGbp : null

    return {
      date: payload?.date ?? '',
      eurToSek: Number.isFinite(eurToSek) ? eurToSek : null,
      usdToSek: Number.isFinite(usdToSek) ? usdToSek : null,
      gbpToSek: Number.isFinite(gbpToSek) ? gbpToSek : null
    }
  }

  const latestPayload = await fetchJson(`${EXCHANGE_RATE_API_BASE_URL}/latest?base=EUR&symbols=SEK,USD,GBP`)
  const historicalResults = await Promise.allSettled(
    HISTORY_DAY_OFFSETS.map((offset) => fetchJson(`${EXCHANGE_RATE_API_BASE_URL}/${getCalendarDateString(offset)}?base=EUR&symbols=SEK,USD,GBP`))
  )

  const mappedEntries = [latestPayload, ...historicalResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)]
    .map(mapExchangePayload)
    .filter((entry) => entry.date)
    .reduce((entries, entry) => {
      if (!entries.some((existingEntry) => existingEntry.date === entry.date)) {
        entries.push(entry)
      }

      return entries
    }, [])
    .sort((left, right) => left.date.localeCompare(right.date))

  const latestEntry = mappedEntries[mappedEntries.length - 1] ?? {}
  const previousEntry = mappedEntries[mappedEntries.length - 2] ?? {}

  return {
    date: latestEntry.date ?? '',
    previousDate: previousEntry.date ?? '',
    eurToSek: latestEntry.eurToSek ?? null,
    usdToSek: latestEntry.usdToSek ?? null,
    gbpToSek: latestEntry.gbpToSek ?? null,
    previous: {
      eurToSek: previousEntry.eurToSek ?? null,
      usdToSek: previousEntry.usdToSek ?? null,
      gbpToSek: previousEntry.gbpToSek ?? null
    },
    history: {
      eur: mappedEntries.map((entry) => ({ label: getShortWeekdayLabelFromDate(entry.date), value: entry.eurToSek, date: entry.date })),
      usd: mappedEntries.map((entry) => ({ label: getShortWeekdayLabelFromDate(entry.date), value: entry.usdToSek, date: entry.date })),
      gbp: mappedEntries.map((entry) => ({ label: getShortWeekdayLabelFromDate(entry.date), value: entry.gbpToSek, date: entry.date }))
    }
  }
}

const fetchWeatherForLocation = async ({ latitude, longitude, name, key }) => {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
    forecast_days: '1',
    timezone: 'auto'
  })
  const payload = await fetchJson(`${WEATHER_API_BASE_URL}?${params.toString()}`)

  return {
    key,
    name,
    temperature: Number(payload?.current?.temperature_2m),
    apparentTemperature: Number(payload?.current?.apparent_temperature),
    windSpeed: Number(payload?.current?.wind_speed_10m),
    humidity: Number(payload?.current?.relative_humidity_2m),
    weatherCode: Number(payload?.current?.weather_code),
    description: getWeatherDescriptionFromCode(Number(payload?.current?.weather_code)),
    maxTemperature: Number(payload?.daily?.temperature_2m_max?.[0]),
    minTemperature: Number(payload?.daily?.temperature_2m_min?.[0]),
    precipitationProbability: Number(payload?.daily?.precipitation_probability_max?.[0] ?? 0),
    uvIndexMax: Number(payload?.daily?.uv_index_max?.[0]),
    sunrise: payload?.daily?.sunrise?.[0] ?? '',
    sunset: payload?.daily?.sunset?.[0] ?? ''
  }
}

const getWeatherComparisonText = (ostersund, marbella) => {
  if (!ostersund || !marbella || !Number.isFinite(ostersund.temperature) || !Number.isFinite(marbella.temperature)) {
    return ''
  }

  const difference = Math.round((marbella.temperature - ostersund.temperature) * 10) / 10
  const hasWindData = Number.isFinite(ostersund.windSpeed) && Number.isFinite(marbella.windSpeed)
  const hasRainData = Number.isFinite(ostersund.precipitationProbability) && Number.isFinite(marbella.precipitationProbability)

  let windComment = ''
  if (hasWindData) {
    const windDifference = marbella.windSpeed - ostersund.windSpeed

    if (windDifference <= -2) {
      windComment = 'Där är det dessutom snällare vindar.'
    } else if (windDifference >= 2) {
      windComment = 'Men vinden tar i lite mer där nere.'
    } else {
      windComment = 'Vindmässigt är det ganska jämnt.'
    }
  }

  let rainComment = ''
  if (hasRainData) {
    const rainDifference = marbella.precipitationProbability - ostersund.precipitationProbability

    if (rainDifference <= -15) {
      rainComment = 'Paraplyet kan troligen vila oftare i Marbella.'
    } else if (rainDifference >= 15) {
      rainComment = 'Paraplyläget är faktiskt lite mer aktivt i Marbella i dag.'
    } else {
      rainComment = 'Regnrisken är ungefär på samma humör på båda håll.'
    }
  }

  if (difference === 0) {
    return ['Oväntat nog är temperaturduellen helt jämn just nu mellan Östersund och Marbella.', windComment, rainComment].filter(Boolean).join(' ')
  }

  if (difference > 0) {
    return [`Marbella vinner den här rundan med ${formatNumber(difference)}° mer värme just nu.`, windComment, rainComment].filter(Boolean).join(' ')
  }

  return [`Östersund står för dagens väderskräll och leder med ${formatNumber(Math.abs(difference))}° just nu.`, windComment, rainComment].filter(Boolean).join(' ')
}

const getCalendarDateString = (dayOffset = 0, timeZone) => {
  const targetDate = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000)

  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(targetDate)
}

const getShortWeekdayLabel = (dayOffset = 0, timeZone) => {
  const targetDate = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000)

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    weekday: 'short'
  }).format(targetDate).replace('.', '')
}

const getShortWeekdayLabelFromDate = (dateString) => {
  if (!dateString) {
    return ''
  }

  return new Intl.DateTimeFormat('sv-SE', {
    weekday: 'short'
  }).format(new Date(`${dateString}T12:00:00`)).replace('.', '')
}

const getChangeDetails = (currentValue, previousValue) => {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return {
      delta: null,
      percentChange: null,
      direction: 'flat',
      color: '#6b7280',
      label: '0,00',
      percentLabel: '0,00%'
    }
  }

  const delta = Math.round((currentValue - previousValue) * 100) / 100
  const percentChange = previousValue !== 0 ? (delta / previousValue) * 100 : null
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : ''
  const label = `${sign}${formatNumber(Math.abs(delta), 2)}`
  const percentLabel = Number.isFinite(percentChange)
    ? `${sign}${formatNumber(Math.abs(percentChange), 2)}%`
    : '—'

  if (delta > 0) {
    return {
      delta,
      percentChange,
      direction: 'up',
      color: '#2f855a',
      label,
      percentLabel
    }
  }

  if (delta < 0) {
    return {
      delta,
      percentChange,
      direction: 'down',
      color: '#c0392b',
      label,
      percentLabel
    }
  }

  return {
    delta: 0,
    percentChange: 0,
    direction: 'flat',
    color: '#6b7280',
    label: '0,00',
    percentLabel: '0,00%'
  }
}

const getTrendPoints = (history) => (history ?? [])
  .filter((entry) => Number.isFinite(entry?.value))
  .map((entry) => ({
    label: entry.label,
    value: entry.value
  }))

const SparklineChart = ({ history, color = '#2f6fa3', fill = 'rgba(47, 111, 163, 0.14)', height = 78 }) => {
  const points = getTrendPoints(history)

  if (points.length < 2) {
    return (
      <div style={{
        height: `${height}px`,
        borderRadius: '10px',
        background: '#f8fafc',
        border: '1px dashed #d2dbe4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
        fontSize: '12px'
      }}>
        För lite trenddata ännu
      </div>
    )
  }

  const width = 320
  const padding = 12
  const values = points.map((point) => point.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = Math.max(maxValue - minValue, 1)
  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1)
  const linePoints = points.map((point, index) => {
    const x = padding + stepX * index
    const y = padding + ((maxValue - point.value) / range) * (height - padding * 2)

    return `${x},${y}`
  }).join(' ')
  const areaPoints = `${padding},${height - padding} ${linePoints} ${width - padding},${height - padding}`

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trendgraf" style={{ width: '100%', height: `${height}px`, display: 'block' }}>
        <polygon points={areaPoints} fill={fill} />
        <polyline
          points={linePoints}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px', color: '#6b7280' }}>
        <span>{points[0]?.label ?? ''}</span>
        <span>{points[points.length - 1]?.label ?? ''}</span>
      </div>
    </div>
  )
}

const FlipCard = ({ flipped, onToggle, minHeight = 220, front, back, frontLabel, backLabel }) => (
  <div className={`flip-card${flipped ? ' is-flipped' : ''}`} style={{ minHeight: `${minHeight}px` }}>
    <div
      className="flip-card-button"
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      }}
      aria-label={flipped ? backLabel ?? 'Visa framsidan' : frontLabel ?? 'Visa baksidan'}
    >
      <div className="flip-card-inner">
        <div className="flip-card-face flip-card-front">
          <div className="flip-card-content">{front}</div>
        </div>
        <div className="flip-card-face flip-card-back">
          <div className="flip-card-content">{back}</div>
        </div>
      </div>
    </div>
  </div>
)

function App() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [answerImage, setAnswerImage] = useState(null)
  const [answerImageAlt, setAnswerImageAlt] = useState('')
  const [answerSourceLabel, setAnswerSourceLabel] = useState('')
  const [questionType, setQuestionType] = useState('general')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [bmi, setBmi] = useState('')
  const [bmiClassification, setBmiClassification] = useState('')
  const [movieResult, setMovieResult] = useState(null)
  const [isLoadingRelatedMovies, setIsLoadingRelatedMovies] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dateTime, setDateTime] = useState(new Date())
  const [showInfo, setShowInfo] = useState(false)
  const [showInfoBack, setShowInfoBack] = useState(false)
  const [flippedCards, setFlippedCards] = useState({})
  const activeMovieRequestRef = useRef(0)
  const [exchangeRates, setExchangeRates] = useState({
    date: '',
    previousDate: '',
    eurToSek: null,
    usdToSek: null,
    gbpToSek: null,
    previous: {
      eurToSek: null,
      usdToSek: null,
      gbpToSek: null
    },
    history: {
      eur: [],
      usd: [],
      gbp: []
    }
  })
  const [oilPrice, setOilPrice] = useState({
    label: 'Brentolja',
    date: '',
    usdPerBarrel: null,
    sekPerBarrel: null,
    previousUsdPerBarrel: null,
    previousSekPerBarrel: null,
    open: null,
    high: null,
    low: null,
    historyUsd: [],
    historySek: []
  })
  const [newsFlashItems, setNewsFlashItems] = useState([])
  const [weatherComparison, setWeatherComparison] = useState({
    ostersund: null,
    marbella: null
  })
  const [spotPrices, setSpotPrices] = useState({
    SE1: { today: null, tomorrow: null, yesterday: null, history: [] },
    SE2: { today: null, tomorrow: null, yesterday: null, history: [] },
    SE3: { today: null, tomorrow: null, yesterday: null, history: [] },
    SE4: { today: null, tomorrow: null, yesterday: null, history: [] }
  })

  const fetchSpotPrices = async () => {
    const areaEntries = await Promise.all(
      SPOT_PRICE_AREAS.map(async (area) => {
        try {
          const [historyEntries, tomorrow] = await Promise.all([
            Promise.all(HISTORY_DAY_OFFSETS.map(async (offset) => ({
              date: getCalendarDateString(offset, SPOT_PRICE_TIME_ZONE),
              label: getShortWeekdayLabel(offset, SPOT_PRICE_TIME_ZONE),
              value: await fetchSpotPriceAverageForDate(area, offset)
            }))),
            fetchSpotPriceAverageForDate(area, 1)
          ])
          const today = historyEntries[historyEntries.length - 1]?.value ?? null
          const yesterday = historyEntries[historyEntries.length - 2]?.value ?? null

          return [area, { today, tomorrow, yesterday, history: historyEntries }]
        } catch (error) {
          console.error(`Error fetching spot prices for ${area}:`, error)
          return [area, { today: null, tomorrow: null, yesterday: null, history: [] }]
        }
      })
    )

    setSpotPrices(Object.fromEntries(areaEntries))
  }

  const fetchWorldSnapshot = async () => {
    try {
      const [rates, weatherEntries, worldHighlights] = await Promise.all([
        fetchExchangeRates(),
        Promise.all(WEATHER_LOCATIONS.map((location) => fetchWeatherForLocation(location))),
        fetchWorldHighlightsFromServer()
      ])

      setExchangeRates(rates)
      setOilPrice({
        label: worldHighlights?.oilPrice?.label ?? 'Brentolja',
        date: worldHighlights?.oilPrice?.date ?? '',
        usdPerBarrel: worldHighlights?.oilPrice?.usdPerBarrel ?? null,
        previousUsdPerBarrel: worldHighlights?.oilPrice?.previousUsdPerBarrel ?? null,
        sekPerBarrel: worldHighlights?.oilPrice?.usdPerBarrel && rates.usdToSek
          ? worldHighlights.oilPrice.usdPerBarrel * rates.usdToSek
          : null,
        previousSekPerBarrel: worldHighlights?.oilPrice?.previousUsdPerBarrel && rates.previous?.usdToSek
          ? worldHighlights.oilPrice.previousUsdPerBarrel * rates.previous.usdToSek
          : null,
        open: worldHighlights?.oilPrice?.open ?? null,
        high: worldHighlights?.oilPrice?.high ?? null,
        low: worldHighlights?.oilPrice?.low ?? null,
        historyUsd: Array.isArray(worldHighlights?.oilPrice?.history)
          ? worldHighlights.oilPrice.history.map((entry) => ({
            ...entry,
            label: entry?.date ? new Intl.DateTimeFormat('sv-SE', { weekday: 'short' }).format(new Date(`${entry.date}T12:00:00`)).replace('.', '') : '',
            value: entry?.usdPerBarrel ?? null
          }))
          : [],
        historySek: Array.isArray(worldHighlights?.oilPrice?.history)
          ? worldHighlights.oilPrice.history.map((entry) => ({
            ...entry,
            label: entry?.date ? new Intl.DateTimeFormat('sv-SE', { weekday: 'short' }).format(new Date(`${entry.date}T12:00:00`)).replace('.', '') : '',
            value: Number.isFinite(entry?.usdPerBarrel) && Number.isFinite(rates.usdToSek)
              ? entry.usdPerBarrel * rates.usdToSek
              : null
          }))
          : []
      })
      setNewsFlashItems(Array.isArray(worldHighlights?.news) ? worldHighlights.news : [])
      setWeatherComparison({
        ostersund: weatherEntries.find((entry) => entry.key === 'ostersund') ?? null,
        marbella: weatherEntries.find((entry) => entry.key === 'marbella') ?? null
      })
    } catch (error) {
      console.error('Error fetching world snapshot:', error)
    }
  }

  const toggleCardFlip = (cardKey) => {
    setFlippedCards((current) => ({
      ...current,
      [cardKey]: !current[cardKey]
    }))
  }

  const openInfoPanel = () => {
    setShowInfo(true)
    setShowInfoBack(false)
  }

  const closeInfoPanel = () => {
    setShowInfo(false)
    setShowInfoBack(false)
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(new Date())
    }, 1000)
    const spotPriceTimer = setTimeout(() => {
      void fetchSpotPrices()
    }, 0)
    const worldSnapshotTimer = setTimeout(() => {
      void fetchWorldSnapshot()
    }, 0)

    return () => {
      clearInterval(timer)
      clearTimeout(spotPriceTimer)
      clearTimeout(worldSnapshotTimer)
    }
  }, [])

  const calculateBMI = () => {
    if (!weight || !height) {
      alert("Vänligen fyll i både vikt och längd")
      return
    }
    const heightInMeters = height / 100
    const bmiValue = weight / (heightInMeters * heightInMeters)
    setBmi(bmiValue.toFixed(1))
    
    let classification = ''
    if (bmiValue < 18.5) {
      classification = 'Underviktig'
    } else if (bmiValue >= 18.5 && bmiValue < 25) {
      classification = 'Normalviktig'
    } else if (bmiValue >= 25 && bmiValue < 30) {
      classification = 'Överviktig'
    } else {
      classification = 'Fet'
    }
    setBmiClassification(classification)
  }

  const fetchMovieDetails = async () => {
    try {
      activeMovieRequestRef.current += 1
      const requestId = activeMovieRequestRef.current
      setLoading(true)
      setIsLoadingRelatedMovies(false)
      setAnswer('')
      setAnswerImage(null)
      setAnswerImageAlt('')
      setAnswerSourceLabel('')
      setMovieResult(null)

      const trimmedTitle = question.trim()
      const notes = []
      const addNote = (note) => {
        if (!notes.includes(note)) {
          notes.push(note)
        }
      }

      if (!trimmedTitle) {
        setAnswer('Skriv en filmtitel först.')
        setIsLoadingRelatedMovies(false)
        setLoading(false)
        return
      }

      const serverPayload = await fetchMovieDetailsFromServer(trimmedTitle)
      const canUseLocalFallback = Boolean(LOCAL_OMDB_API_KEY || LOCAL_TMDB_API_KEY)

      if (serverPayload) {
        if (serverPayload.ok && serverPayload.movie) {
          setMovieResult(serverPayload.movie)
          setIsLoadingRelatedMovies(false)
          setLoading(false)

          if (serverPayload.movie.supportsRelatedMovies) {
            setIsLoadingRelatedMovies(true)

            void fetchMovieDetailsFromServer(trimmedTitle, { relatedOnly: true })
              .then((relatedPayload) => {
                if (activeMovieRequestRef.current !== requestId || !relatedPayload?.ok) {
                  return
                }

                setMovieResult((currentMovie) => {
                  if (!currentMovie) {
                    return currentMovie
                  }

                  return {
                    ...currentMovie,
                    relatedMovies: Array.isArray(relatedPayload.relatedMovies) ? relatedPayload.relatedMovies : currentMovie.relatedMovies
                  }
                })
              })
              .catch((error) => {
                console.error('Error fetching related movies in background:', error)
              })
              .finally(() => {
                if (activeMovieRequestRef.current === requestId) {
                  setIsLoadingRelatedMovies(false)
                }
              })
          }

          return
        }

        if (!canUseLocalFallback || serverPayload.code === 'MISSING_CONFIG') {
          setAnswer(serverPayload.error ?? 'Kunde inte hitta filmen. Kontrollera titeln och prova igen.')
          setIsLoadingRelatedMovies(false)
          setIsLoadingRelatedMovies(false)
          setLoading(false)
          return
        }
      }

      if (!LOCAL_OMDB_API_KEY && !LOCAL_TMDB_API_KEY) {
        setAnswer(
          'Filmkategorin behöver API-nycklar innan den kan användas.\n\n' +
          'På Vercel lägger du in detta under Project Settings -> Environment Variables:\n' +
          'OMDB_API_KEY=din_omdb_nyckel\n' +
          'TMDB_API_KEY=din_tmdb_nyckel\n\n' +
          'Om du bara kör lokalt i Vite kan du också använda detta i .env.local:\n' +
          'VITE_OMDB_API_KEY=din_omdb_nyckel\n' +
          'VITE_TMDB_API_KEY=din_tmdb_nyckel'
        )
        setIsLoadingRelatedMovies(false)
        setLoading(false)
        return
      }

      if (!LOCAL_OMDB_API_KEY) {
        addNote('IMDb och Rotten Tomatoes visas så fort OMDb-nyckeln är konfigurerad.')
      }

      if (!LOCAL_TMDB_API_KEY) {
        addNote('Streaming visas så fort TMDB-nyckeln är konfigurerad.')
      }

      let omdbMovie = null
      let tmdbMovie = null

      if (LOCAL_OMDB_API_KEY) {
        try {
          omdbMovie = await fetchMovieRatingsFromOmdb(trimmedTitle)
        } catch (error) {
          console.error('Error fetching movie ratings:', error)
          addNote('Kunde inte hämta filmbetyg just nu.')
        }
      }

      if (LOCAL_TMDB_API_KEY) {
        try {
          tmdbMovie = await fetchMovieStreamingFromTmdb(
            omdbMovie?.title ?? trimmedTitle,
            getMovieYearNumber(omdbMovie?.year)
          )
        } catch (error) {
          console.error('Error fetching movie streaming providers:', error)
          addNote('Kunde inte hämta streamingtjänster just nu.')
        }
      }

      if (!omdbMovie && !tmdbMovie) {
        setAnswer(
          notes.length > 0
            ? `Kunde inte hämta filmdata.\n\n${notes.join('\n')}`
            : 'Kunde inte hitta filmen. Kontrollera titeln och prova igen.'
        )
        setIsLoadingRelatedMovies(false)
        setLoading(false)
        return
      }

      const providers = tmdbMovie?.providers ?? EMPTY_MOVIE_PROVIDERS
      const hasStreamingOptions = Object.values(providers).some((providerList) => providerList.length > 0)

      if (tmdbMovie && !hasStreamingOptions) {
        addNote('Ingen streaming eller butikstjänst hittades i Sverige just nu.')
      }

      setMovieResult({
        title: omdbMovie?.title ?? tmdbMovie?.title ?? trimmedTitle,
        year: omdbMovie?.year ?? (tmdbMovie?.year ? String(tmdbMovie.year) : ''),
        plot: omdbMovie?.plot ?? '',
        genre: omdbMovie?.genre ?? '',
        poster: omdbMovie?.poster ?? '',
        imdbRating: omdbMovie?.imdbRating ?? null,
        rottenTomatoesRating: omdbMovie?.rottenTomatoesRating ?? null,
        relatedMovies: [],
        supportsRelatedMovies: false,
        providers,
        hasStreamingOptions,
        streamingLink: tmdbMovie?.link ?? null,
        notes
      })
      setIsLoadingRelatedMovies(false)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching movie details:', error)
      setAnswer('Något gick fel vid hämtning av filmdata. Försök igen senare.')
      setMovieResult(null)
      setIsLoadingRelatedMovies(false)
      setLoading(false)
    }
  }

  const fetchAnswerFromInternet = async () => {
    try {
      setLoading(true)
      setMovieResult(null)
      setAnswerImage(null)
      setAnswerImageAlt('')
      setAnswerSourceLabel('')
      const shortAnswer = await fetchShortAnswerFromWikipedia(question)

      if (shortAnswer) {
        setAnswer(shortAnswer.answer)
        setAnswerImage(shortAnswer.imageUrl ?? null)
        setAnswerImageAlt(shortAnswer.imageAlt ?? '')
        setAnswerSourceLabel(shortAnswer.sourceLabel ?? '')
        setLoading(false)
        return
      }

      setAnswer('Kunde inte hitta ett kort svar. Försök med ett tydligare ämne eller en enklare fråga.')
      setLoading(false)
    } catch (error) {
      console.error('Error fetching answer:', error)
      setAnswer('Något gick fel vid hämtning av svar. Försök igen senare.')
      setLoading(false)
    }
  }

  const handleClick = () => {
    if (questionType === 'bmi') {
      calculateBMI()
      return
    }

    setMovieResult(null)
    setIsLoadingRelatedMovies(false)

    if (!question) {
      setAnswer(questionType === 'movie' ? 'Skriv en filmtitel först.' : 'Skriv en fråga först 🙂')
      return
    }

    if (questionType === 'movie') {
      fetchMovieDetails()
      return
    }

    fetchAnswerFromInternet()
  }

  const isBmiQuestion = questionType === 'bmi'
  const isMovieQuestion = questionType === 'movie'
  const marketCards = [
    {
      key: 'eur',
      symbol: '€',
      label: 'EUR till SEK',
      currentValue: exchangeRates.eurToSek,
      previousValue: exchangeRates.previous?.eurToSek ?? null,
      displayValue: exchangeRates.eurToSek !== null ? `${formatNumber(exchangeRates.eurToSek, 2)} kr` : '—',
      previousDisplayValue: exchangeRates.previous?.eurToSek !== null ? `${formatNumber(exchangeRates.previous.eurToSek, 2)} kr` : '—',
      sublabel: '1 EUR',
      history: exchangeRates.history?.eur ?? [],
      detailLines: [
        `Senast uppdaterad ${exchangeRates.date || '—'}`,
        `I går ${exchangeRates.previousDate || '—'}: ${exchangeRates.previous?.eurToSek !== null ? `${formatNumber(exchangeRates.previous.eurToSek, 2)} kr` : '—'}`
      ]
    },
    {
      key: 'usd',
      symbol: '$',
      label: 'USD till SEK',
      currentValue: exchangeRates.usdToSek,
      previousValue: exchangeRates.previous?.usdToSek ?? null,
      displayValue: exchangeRates.usdToSek !== null ? `${formatNumber(exchangeRates.usdToSek, 2)} kr` : '—',
      previousDisplayValue: exchangeRates.previous?.usdToSek !== null ? `${formatNumber(exchangeRates.previous.usdToSek, 2)} kr` : '—',
      sublabel: '1 USD',
      history: exchangeRates.history?.usd ?? [],
      detailLines: [
        `Senast uppdaterad ${exchangeRates.date || '—'}`,
        `I går ${exchangeRates.previousDate || '—'}: ${exchangeRates.previous?.usdToSek !== null ? `${formatNumber(exchangeRates.previous.usdToSek, 2)} kr` : '—'}`
      ]
    },
    {
      key: 'gbp',
      symbol: '£',
      label: 'GBP till SEK',
      currentValue: exchangeRates.gbpToSek,
      previousValue: exchangeRates.previous?.gbpToSek ?? null,
      displayValue: exchangeRates.gbpToSek !== null ? `${formatNumber(exchangeRates.gbpToSek, 2)} kr` : '—',
      previousDisplayValue: exchangeRates.previous?.gbpToSek !== null ? `${formatNumber(exchangeRates.previous.gbpToSek, 2)} kr` : '—',
      sublabel: '1 GBP',
      history: exchangeRates.history?.gbp ?? [],
      detailLines: [
        `Senast uppdaterad ${exchangeRates.date || '—'}`,
        `I går ${exchangeRates.previousDate || '—'}: ${exchangeRates.previous?.gbpToSek !== null ? `${formatNumber(exchangeRates.previous.gbpToSek, 2)} kr` : '—'}`
      ]
    },
    {
      key: 'brent',
      symbol: 'BRENT',
      label: oilPrice.label,
      currentValue: oilPrice.usdPerBarrel,
      previousValue: oilPrice.previousUsdPerBarrel,
      displayValue: oilPrice.usdPerBarrel !== null ? `${formatNumber(oilPrice.usdPerBarrel, 2)} USD` : '—',
      previousDisplayValue: oilPrice.previousUsdPerBarrel !== null ? `${formatNumber(oilPrice.previousUsdPerBarrel, 2)} USD` : '—',
      sublabel: oilPrice.sekPerBarrel !== null ? `≈ ${formatNumber(oilPrice.sekPerBarrel, 0)} kr/fat` : 'per fat',
      history: oilPrice.historyUsd ?? [],
      detailLines: [
        `I går: ${oilPrice.previousUsdPerBarrel !== null ? `${formatNumber(oilPrice.previousUsdPerBarrel, 2)} USD` : '—'}`,
        `Öppning ${oilPrice.open !== null ? `${formatNumber(oilPrice.open, 2)} USD` : '—'}`,
        `Dagshögsta ${oilPrice.high !== null ? `${formatNumber(oilPrice.high, 2)} USD` : '—'}`,
        `Dagslägsta ${oilPrice.low !== null ? `${formatNumber(oilPrice.low, 2)} USD` : '—'}`
      ]
    }
  ]
  const electricityCards = [
    { area: 'SE1', name: 'Luleå', ...spotPrices.SE1 },
    { area: 'SE2', name: 'Sundsvall', ...spotPrices.SE2 },
    { area: 'SE3', name: 'Stockholm', ...spotPrices.SE3 },
    { area: 'SE4', name: 'Malmö', ...spotPrices.SE4 }
  ]
  const weatherCards = [
    weatherComparison.ostersund ? weatherComparison.ostersund : { key: 'ostersund', name: 'Östersund' },
    weatherComparison.marbella ? weatherComparison.marbella : { key: 'marbella', name: 'Marbella' }
  ]
  const infoHighlights = [
    {
      title: 'Frontend',
      meta: 'React 19 + Hooks',
      text: 'React 19 driver gränssnittet, lokalt state och de interaktiva korten med snabb respons i browsern.'
    },
    {
      title: 'Serverlager',
      meta: 'Vercel Functions',
      text: 'Vercel Functions fungerar som ett tunt backend-lager för filmdata, olja och nyhetsflash.'
    },
    {
      title: 'Bygg & deploy',
      meta: 'Vite + GitHub + Vercel',
      text: 'Vite bygger appen, Node.js kör verktygen lokalt och Vercel deployar automatiskt från GitHub.'
    },
    {
      title: 'AI & workflow',
      meta: 'Codex + BMAD',
      text: 'Codex användes i utvecklingen och repo:t innehåller BMAD-artifakter för planering, iteration och implementation.'
    }
  ]
  const weatherLocationDetails = {
    ostersund: {
      region: 'Jämtland, Sverige',
      vibe: 'Fjällnära stad med tydliga årstider, kallare luft och ofta friskare vinterkänsla.',
      readout: 'Bra att hålla koll på när det blåser eller när temperaturen känns betydligt lägre än termometern visar.'
    },
    marbella: {
      region: 'Costa del Sol, Spanien',
      vibe: 'Medelhavskust med mildare vintrar, mer solchanser och ofta torrare luft än hemma.',
      readout: 'Intressant att jämföra mot Östersund när man vill se värmeskillnad, regnrisk och om vinden sabbar uteserveringsläget.'
    }
  }
  const techHighlights = [
    {
      title: 'React + Hooks',
      text: 'Driver hela gränssnittet och all interaktion i appen.',
      details: 'React 19 renderar hela upplevelsen i ett sammanhållet komponentträd. useState håller ihop frågor, livekort, flip-status och filmresultat, medan useEffect startar klockan och de initiala datahämtningarna när sidan laddas.',
      learnMoreLabel: 'react.dev/learn',
      learnMoreUrl: 'https://react.dev/learn'
    },
    {
      title: 'Vite',
      text: 'Snabb lokal utveckling, build och enkel väg till produktion.',
      details: 'Vite ger kort starttid i utveckling, snabb HMR när UI:t ändras och ett produktionsbygge som passar bra för Vercel. I repo:t finns också en lokal brygga så att /api/world och filmanrop fungerar smidigt under npm run dev.',
      learnMoreLabel: 'vite.dev/guide',
      learnMoreUrl: 'https://vite.dev/guide/'
    },
    {
      title: 'Vercel Functions',
      text: 'Serverkod för film, Brentolja och nyhetsflash.',
      details: 'Funktionerna används för sådant som inte bör ligga öppet i browsern, som privata API-nycklar, externa anrop och datakällor som blir stabilare när de hämtas på serversidan innan de skickas vidare till klienten.',
      learnMoreLabel: 'vercel.com/docs/functions',
      learnMoreUrl: 'https://vercel.com/docs/functions'
    },
    {
      title: 'Wikipedia API',
      text: 'Faktasvar och bilder för allmänna frågor.',
      details: 'Appen använder både sök och summary-endpointen för att hitta rätt ämne, plocka fram en kort introduktion och komplettera med en passande bild när en sådan finns tillgänglig.',
      learnMoreLabel: 'mediawiki.org/wiki/API:REST_API',
      learnMoreUrl: 'https://www.mediawiki.org/wiki/API:REST_API'
    },
    {
      title: 'OMDb + TMDB',
      text: 'Filmbetyg, posters, svenska streamingtjänster och seriejämförelser.',
      details: 'OMDb står främst för IMDb- och Rotten Tomatoes-betyg medan TMDB hjälper till med posters, träffsäker matchning och streaming i Sverige. Flödet är också byggt för att tåla lättare felstavning och kunna hitta närliggande filmer i samma serie.',
      learnMoreLabel: 'omdbapi.com / developer.themoviedb.org',
      learnMoreUrl: 'https://developer.themoviedb.org/docs/getting-started'
    },
    {
      title: 'Frankfurter + Elpriset just nu',
      text: 'Valutor och elpriser med dagsjämförelser och trendspår.',
      details: 'Valutakorten visar dagens nivå mot gårdagen och elpriserna bygger på dagliga medelvärden i öre per kWh. Historiken används sedan för att skapa små trendgrafer och göra korten mer beslutsstödjande än statiska siffror.',
      learnMoreLabel: 'frankfurter.dev / elprisetjustnu.se',
      learnMoreUrl: 'https://frankfurter.dev/docs/'
    },
    {
      title: 'Open-Meteo',
      text: 'Väderduell med temperatur, vind, regn, UV och soltider.',
      details: 'Väderkorten hämtar både nuvärden och dagsdata som max/min, nederbördsrisk, luftfuktighet och solens upp- och nedgång. Det gör jämförelsen mer komplett och mer användbar än en enkel temperaturvisning.',
      learnMoreLabel: 'open-meteo.com/en/docs',
      learnMoreUrl: 'https://open-meteo.com/en/docs'
    },
    {
      title: 'Yahoo Finance + RSS',
      text: 'Brenttrend och nyhetsflash i samma överblick.',
      details: 'Brentoljan kommer från Yahoo Finances chart-data och nyhetsflashen sammanställs från RSS-källor. Kombinationen gör att världen-sektionen känns mer som ett levande lägesrum än en statisk lista med separata datapunkter.',
      learnMoreLabel: 'finance chart / rss spec',
      learnMoreUrl: 'https://www.rssboard.org/rss-specification'
    },
    {
      title: 'AI-stöd i bygget',
      text: 'Codex och BMAD-artifakter hjälpte utvecklingsflödet.',
      details: 'Själva appen kör inte AI i produktion, men i byggprocessen användes AI-stöd för kodning, tekniska artefakter, UI-polish och iterationer. Det märks främst i hur snabbt funktioner och förbättringar kunnat drivas från idé till färdig detalj i samma repo.',
      learnMoreLabel: 'OpenAI platform docs',
      learnMoreUrl: 'https://platform.openai.com/docs'
    },
    {
      title: 'GitHub + Vercel',
      text: 'Versionshantering och deployflöde.',
      details: 'GitHub håller kodhistoriken och fungerar som samlingspunkt för förändringar, medan Vercel bygger och deployar när rätt branch pushas. Det gör att frontend och serverfunktioner kan skickas tillsammans i samma releaseflöde.',
      learnMoreLabel: 'vercel.com/docs/git',
      learnMoreUrl: 'https://vercel.com/docs/git'
    }
  ]
  const patternHighlights = [
    {
      title: 'Komponentdriven UI',
      text: 'Allt ligger i återanvändbara delar och sektioner.',
      details: 'Appen är byggd som en enda React-app där olika vyer, kort och resultat presenteras via komponentliknande JSX-block och delad state i samma träd.'
    },
    {
      title: 'Client state med hooks',
      text: 'useState och useEffect håller ihop live-data och interaktion.',
      details: 'Frågetyp, filmresultat, trendkort, nyheter, väder och klocka hålls i lokal komponent-state. Det gör appen snabb utan extern state manager.'
    },
    {
      title: 'Server-facade / BFF-light',
      text: 'Klienten går via Vercel Functions när nycklar eller robustare hämtning behövs.',
      details: 'Det här mönstret skyddar API-nycklar bättre, ger central felhantering och låter frontend slippa känna till alla externa svarformat.'
    },
    {
      title: 'Resilient fetching',
      text: 'Flera funktioner har fallbackar i stället för att dö helt.',
      details: 'Appen provar serverväg först för film, använder flera sökvarianter, klarar saknade datapunkter och visar fallbacktext när en datakälla inte svarar.'
    },
    {
      title: 'Derived data',
      text: 'Historik, trender och jämförelser räknas fram ovanpå rådata.',
      details: 'Valutaförändring, börslik +/-, eltrender, oljehistorik och väderjämförelse är inte hårdkodade utan beräknas i klienten från hämtade värden.'
    },
    {
      title: 'Progressive disclosure',
      text: 'Framsida först, mer info på baksidan.',
      details: 'Flipkorten används som ett disclosure-mönster: det viktigaste syns direkt och detaljerna finns ett klick bort, vilket håller översikten renare.'
    }
  ]
  const toolingHighlights = [
    {
      title: 'VS Code',
      text: 'Redigeringsmiljö för kod, filer och iteration.',
      details: 'Utvecklingsflödet här utgår från en editor-baserad arbetsyta där filer, env-vars och artefakter ligger i samma repo och kan itereras snabbt.'
    },
    {
      title: 'Codex',
      text: 'AI-assisterad kodning, refaktorering och implementation.',
      details: 'Codex användes i själva utvecklingsarbetet för att analysera repo:t, skriva kod, verifiera ändringar och föra funktioner från idé till färdig implementation.'
    },
    {
      title: 'BMAD-artifakter',
      text: 'Planerings- och implementationsstöd i repo:t.',
      details: 'Mappar som .agents, _bmad och _bmad-output visar att repo:t inte bara innehåller appkod utan också ett strukturstöd för stories, tech specs och agentworkflow.'
    },
    {
      title: 'Node.js + npm',
      text: 'Kör verktygskedjan lokalt.',
      details: 'Node.js används som runtime för verktyg, Vite och lokala script. npm driver kommandon som dev, build och lint i projektet.'
    },
    {
      title: 'ESLint',
      text: 'Kodkvalitet och snabb feedback.',
      details: 'Linting används som ett skyddsnät efter förändringar så att JSX, hooks och allmän kodstruktur håller ihop innan deploy.'
    },
    {
      title: 'GitHub',
      text: 'Versionshantering och samlingspunkt för deploy.',
      details: 'Koden pushas till GitHub och fungerar som källa för Vercel-deploy, historik och versionsspårning.'
    }
  ]
  const modalOverviewGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 210px))',
    justifyContent: 'center',
    gap: '10px',
    margin: '0 auto 16px auto',
    maxWidth: '620px',
    alignItems: 'stretch'
  }
  const modalDetailGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    justifyContent: 'center',
    gap: '12px',
    margin: '0 auto 14px auto',
    maxWidth: '100%',
    alignItems: 'stretch'
  }
  const infoSheetActionButtonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 14px',
    borderRadius: '999px',
    border: '1px solid #d6e1ea',
    background: '#fff',
    color: '#1f4b78',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    textDecoration: 'none'
  }
  const infoSheetSurfaceStyle = {
    background: '#fff',
    borderRadius: '18px',
    border: '1px solid #cfd9e2',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.22)',
    padding: 'clamp(18px, 3vw, 28px)',
    cursor: 'default',
    minHeight: '100%',
    boxSizing: 'border-box'
  }
  const infoSectionHeadingStyle = {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: '6px',
    textAlign: 'center'
  }
  const infoSectionIntroStyle = {
    maxWidth: '680px',
    margin: '0 auto 14px auto',
    fontSize: '13px',
    color: '#5f6b76',
    lineHeight: '1.7',
    textAlign: 'center'
  }
  const infoDetailCardTitleStyle = {
    margin: '0',
    fontWeight: '800',
    fontSize: '14px',
    lineHeight: '1.3',
    textAlign: 'center'
  }
  const infoDetailCardTextStyle = {
    margin: '0',
    color: '#4b5563',
    fontSize: '12px',
    lineHeight: '1.68',
    textAlign: 'center'
  }
  const infoDetailCardFrontStyle = {
    background: 'linear-gradient(180deg, #f7fbff 0%, #eef4fa 100%)',
    padding: '14px 14px 16px 14px',
    borderRadius: '14px',
    border: '1px solid #dbe5ee',
    display: 'grid',
    gap: '8px',
    alignContent: 'start',
    height: '100%',
    textAlign: 'center',
    boxSizing: 'border-box'
  }
  const infoDetailCardBackStyle = {
    ...infoDetailCardFrontStyle,
    background: 'linear-gradient(180deg, #ffffff 0%, #f5f9fd 100%)'
  }
  const sectionWrapperStyle = {
    width: '100%',
    maxWidth: APP_SECTION_MAX_WIDTH
  }
  const liveSectionCardStyle = {
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '14px',
    padding: '16px',
    border: '1px solid #d2dbe4',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)'
  }
  const liveSectionTitleStyle = {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: '800',
    color: '#2f6fa3',
    textAlign: 'center'
  }
  const liveCardGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '10px'
  }
  const liveFlipCardBaseStyle = {
    background: '#f8fbff',
    border: '1px solid #dbe5ee',
    borderRadius: '12px',
    minWidth: 0,
    height: '100%'
  }
  const liveFlipCardFrontStyle = {
    ...liveFlipCardBaseStyle,
    padding: '13px 12px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    gap: '10px'
  }
  const liveFlipCardBackStyle = {
    ...liveFlipCardBaseStyle,
    padding: '14px 12px',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  }
  const liveCardIconStyle = {
    width: '40px',
    height: '40px',
    borderRadius: '14px',
    background: '#e8f0f8',
    color: '#2f6fa3',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700',
    margin: '0 auto 8px auto'
  }
  const liveCardTitleStyle = {
    fontSize: '12px',
    fontWeight: '700',
    color: '#2f6fa3',
    margin: '0 0 5px 0',
    lineHeight: '1.28'
  }
  const liveCardValueStyle = {
    fontSize: '21px',
    fontWeight: '700',
    color: '#222',
    margin: '0 0 4px 0',
    whiteSpace: 'nowrap'
  }
  const liveCardMetaStyle = {
    fontSize: '12px',
    color: '#4b5563',
    margin: '0',
    lineHeight: '1.35'
  }
  const liveCardMetricGridStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '7px'
  }
  const liveCardMetricStyle = {
    background: '#fff',
    borderRadius: '10px',
    padding: '8px 10px',
    border: '1px solid #edf2f7'
  }
  const liveCardMetricLabelStyle = {
    margin: '0 0 4px 0',
    fontSize: '11px',
    color: '#6b7280',
    lineHeight: '1.2'
  }
  const liveCardMetricValueStyle = {
    margin: '0',
    fontSize: '13px',
    fontWeight: '700',
    color: '#1f2937',
    lineHeight: '1.3'
  }
  const liveCardFooterStyle = {
    margin: '0',
    fontSize: '11px',
    color: '#64748b',
    lineHeight: '1.4'
  }
  const liveCardHintStyle = {
    margin: '0',
    fontSize: '10px',
    color: '#94a3b8'
  }
  const liveCardFooterGroupStyle = {
    display: 'grid',
    gap: '5px'
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8f9fa',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '20px 16px 32px 16px',
      color: '#202122'
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', paddingTop: '18px' }}>
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid #a2a9b1',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
          padding: 'clamp(18px, 4vw, 28px)',
          maxWidth: APP_SECTION_MAX_WIDTH,
          width: '100%',
          position: 'relative'
        }}>
        <div style={{ width: '100%', maxWidth: '620px', margin: '0 auto' }}>
        <div style={{ position: 'absolute', top: '15px', right: '15px' }}>
          <button
            onClick={openInfoPanel}
            style={{
              background: '#f3f7fb',
              border: '1px solid #a7b9c9',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '17px',
              fontWeight: '700',
              color: '#2f6fa3',
              transition: 'all 0.3s ease',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
              padding: '0'
            }}
            onMouseOver={(e) => {
              e.target.style.boxShadow = '0 3px 8px rgba(0, 0, 0, 0.14)'
              e.target.style.transform = 'translateY(-1px)'
            }}
            onMouseOut={(e) => {
              e.target.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.08)'
              e.target.style.transform = 'scale(1)'
            }}
            title="Information"
          >
            i
          </button>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          marginBottom: '16px'
        }}>
          <img
            src="/favicon.svg"
            alt="Maxipedia"
            style={{
              width: '52px',
              height: '52px',
              display: 'block',
              flexShrink: 0
            }}
          />
          <div style={{ textAlign: 'left' }}>
            <p style={{
              margin: '0',
              fontSize: 'clamp(26px, 7vw, 33px)',
              lineHeight: '1.02',
              color: '#202122',
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: '700'
            }}>Maxipedia</p>
          </div>
        </div>

        <div style={{
          background: '#f6f9fc',
          borderRadius: '12px',
          border: '1px solid #d2dbe4',
          padding: '12px',
          marginBottom: '20px'
        }}>
          <div className="question-type-grid">
            <label className="question-type-option" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '999px',
              background: questionType === 'general' ? '#e9f1f8' : '#fff',
              color: '#202122',
              border: `1px solid ${questionType === 'general' ? '#2f6fa3' : '#d2dbe4'}`,
              boxShadow: 'none'
            }}>
              <input
                type="radio"
                name="questionType"
                value="general"
                checked={questionType === 'general'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setAnswerImage(null)
                  setAnswerImageAlt('')
                  setAnswerSourceLabel('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setMovieResult(null)
                }}
                style={{ cursor: 'pointer', margin: '0' }}
              />
              <span style={{ fontSize: '14px', fontWeight: '700' }}>Allmän fråga</span>
            </label>
            <label className="question-type-option" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '999px',
              background: questionType === 'bmi' ? '#e9f1f8' : '#fff',
              color: '#202122',
              border: `1px solid ${questionType === 'bmi' ? '#2f6fa3' : '#d2dbe4'}`,
              boxShadow: 'none'
            }}>
              <input
                type="radio"
                name="questionType"
                value="bmi"
                checked={questionType === 'bmi'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setAnswerImage(null)
                  setAnswerImageAlt('')
                  setAnswerSourceLabel('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setMovieResult(null)
                }}
                style={{ cursor: 'pointer', margin: '0' }}
              />
              <span style={{ fontSize: '14px', fontWeight: '700' }}>Hälsa & BMI</span>
            </label>
            <label className="question-type-option" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '999px',
              background: questionType === 'movie' ? '#e9f1f8' : '#fff',
              color: '#202122',
              border: `1px solid ${questionType === 'movie' ? '#2f6fa3' : '#d2dbe4'}`,
              boxShadow: 'none'
            }}>
              <input
                type="radio"
                name="questionType"
                value="movie"
                checked={questionType === 'movie'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setAnswerImage(null)
                  setAnswerImageAlt('')
                  setAnswerSourceLabel('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setMovieResult(null)
                }}
                style={{ cursor: 'pointer', margin: '0' }}
              />
              <span style={{ fontSize: '14px', fontWeight: '700' }}>Filmtitel</span>
            </label>
          </div>
        </div>

        {(questionType === 'general' || isMovieQuestion) && (
          <>
            {isMovieQuestion && (
              <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#4b5563', lineHeight: '1.6' }}>
                Sök på svensk eller utländsk filmtitel. Lite felstavning fungerar också.
              </p>
            )}
            <input
              type="text"
              placeholder={isMovieQuestion ? 'Skriv en filmtitel, till exempel Harry Potter eller Lejonkungen' : 'Skriv din fråga...'}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value)
                setAnswer('')
                setAnswerImage(null)
                setAnswerImageAlt('')
                setAnswerSourceLabel('')
                setWeight('')
                setHeight('')
                setBmi('')
                setBmiClassification('')
                setMovieResult(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleClick()
                }
              }}
              style={{
                width: '100%',
                padding: '14px 16px',
                fontSize: '16px',
                border: '1px solid #a2a9b1',
                borderRadius: '12px',
                boxSizing: 'border-box',
                transition: 'all 0.3s ease',
                outline: 'none',
                marginBottom: '20px',
                background: '#fff',
                color: '#202122'
              }}
              onFocus={(e) => e.target.style.borderColor = '#3366cc'}
              onBlur={(e) => e.target.style.borderColor = '#a2a9b1'}
            />
          </>
        )}

        {isBmiQuestion && (
          <div style={{
            background: '#f6f9fc',
            borderRadius: '12px',
            border: '1px solid #d2dbe4',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <div style={{ marginBottom: '15px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#4b5563',
                marginBottom: '8px'
              }}>Vikt (kg)</label>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value === '' ? '' : parseFloat(e.target.value))}
                placeholder="Ange vikt"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14px',
                  border: '1px solid #a2a9b1',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  outline: 'none',
                  background: '#fff'
                }}
              />
            </div>
            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#4b5563',
                marginBottom: '8px'
              }}>Längd (cm)</label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value === '' ? '' : parseFloat(e.target.value))}
                placeholder="Ange längd"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14px',
                  border: '1px solid #a2a9b1',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  outline: 'none',
                  background: '#fff'
                }}
              />
            </div>
            {bmi && (
              <div style={{
                marginTop: '15px',
                padding: '15px',
                background: 'white',
                borderRadius: '8px',
                textAlign: 'center',
                border: '1px solid #dbe5ee'
              }}>
                <p style={{ color: '#6b7280', fontSize: '12px', margin: '0 0 5px 0' }}>Ditt BMI</p>
                <h2 style={{ color: '#2f6fa3', fontSize: '36px', fontWeight: '700', margin: '0 0 10px 0' }}>{bmi}</h2>
                <p style={{ color: '#2f6fa3', fontSize: '14px', fontWeight: '600', margin: '0' }}>{bmiClassification}</p>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleClick}
          disabled={loading}
          style={{
            width: '100%',
            padding: '14px 24px',
            fontSize: '16px',
            fontWeight: '600',
            color: 'white',
            background: 'linear-gradient(180deg, #447ff5 0%, #3366cc 100%)',
            border: 'none',
            borderRadius: '12px',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: '0 4px 15px rgba(51, 102, 204, 0.28)',
            marginBottom: '25px',
            opacity: loading ? 0.7 : 1
          }}
          onMouseOver={(e) => {
            if (!loading) {
              e.target.style.boxShadow = '0 6px 20px rgba(51, 102, 204, 0.38)'
              e.target.style.transform = 'translateY(-2px)'
            }
          }}
          onMouseOut={(e) => {
            e.target.style.boxShadow = '0 4px 15px rgba(51, 102, 204, 0.28)'
            e.target.style.transform = 'translateY(0)'
          }}
        >
          {loading ? 'Laddar...' : questionType === 'bmi' ? 'Beräkna BMI' : questionType === 'movie' ? 'Sök film' : 'Få svar'}
        </button>

        {loading && isMovieQuestion && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '12px 14px',
            marginBottom: '20px',
            borderRadius: '12px',
            background: '#f8fbff',
            border: '1px solid #dbe5ee',
            color: '#4b5563'
          }}>
            <span className="loading-spinner loading-spinner-large" aria-hidden="true" />
            <div style={{ textAlign: 'left' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: '700', color: '#1f4b78' }}>Filmen letas fram</p>
              <p style={{ margin: '0', fontSize: '12px', lineHeight: '1.5' }}>Vi matchar titel, betyg och streaming just nu.</p>
            </div>
          </div>
        )}

        {isMovieQuestion && movieResult && (
          <div style={{
            background: '#f4f7fb',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid #dbe5ee',
            borderLeft: '5px solid #2f6fa3',
            marginBottom: '20px'
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              alignItems: 'center',
              flexWrap: 'wrap'
            }}>
              {movieResult.poster ? (
                <img
                  src={movieResult.poster}
                  alt={movieResult.title}
                  style={{
                    width: '120px',
                    borderRadius: '10px',
                    objectFit: 'cover',
                    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.12)'
                  }}
                />
              ) : (
                <div style={{
                  width: '120px',
                  minHeight: '180px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #edf3f8 0%, #dbe5ee 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#2f6fa3',
                  fontSize: '12px',
                  fontWeight: '700',
                  textAlign: 'center',
                  padding: '12px',
                    boxSizing: 'border-box'
                  }}>
                  Ingen poster
                </div>
              )}

              <div style={{ width: '100%', maxWidth: '520px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <h2 style={{ margin: '0 0 4px 0', fontSize: '26px', color: '#1f2937' }}>{movieResult.title}</h2>
                  <p style={{ margin: '0', color: '#4b5563', fontSize: '14px' }}>
                    {movieResult.year || 'År okänt'}
                    {movieResult.genre ? ` - ${movieResult.genre}` : ''}
                  </p>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '10px',
                  marginBottom: '14px'
                }}>
                  <div style={{ background: 'white', borderRadius: '10px', padding: '12px' }}>
                    <p style={{ margin: '0 0 4px 0', color: '#6b7280', fontSize: '12px', fontWeight: '600' }}>IMDb</p>
                    <p style={{ margin: '0', color: '#1f2937', fontSize: '20px', fontWeight: '700' }}>{movieResult.imdbRating ?? 'Saknas'}</p>
                  </div>
                  <div style={{ background: 'white', borderRadius: '10px', padding: '12px' }}>
                    <p style={{ margin: '0 0 4px 0', color: '#6b7280', fontSize: '12px', fontWeight: '600' }}>Rotten Tomatoes</p>
                    <p style={{ margin: '0', color: '#1f2937', fontSize: '20px', fontWeight: '700' }}>{movieResult.rottenTomatoesRating ?? 'Saknas'}</p>
                  </div>
                </div>

                {movieResult.plot && (
                  <p style={{
                    margin: '0 0 14px 0',
                    color: '#374151',
                    fontSize: '14px',
                    lineHeight: '1.7'
                  }}>
                    {movieResult.plot}
                  </p>
                )}

                <div style={{ marginBottom: '12px' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '700', color: '#2f6fa3' }}>
                    Streaming i Sverige
                  </p>
                  {MOVIE_PROVIDER_SECTIONS.filter(({ key }) => movieResult.providers[key]?.length > 0).length > 0 ? (
                    <div style={{ display: 'grid', gap: '8px' }}>
                      {MOVIE_PROVIDER_SECTIONS.filter(({ key }) => movieResult.providers[key]?.length > 0).map(({ key, label }) => (
                        <div key={key} style={{ background: 'white', borderRadius: '10px', padding: '10px 12px' }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>{label}</p>
                          <p style={{ margin: '0', fontSize: '14px', color: '#111827' }}>{movieResult.providers[key].join(', ')}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: '0', fontSize: '14px', color: '#6b7280' }}>
                      Ingen streaming eller butikstjänst hittades i Sverige just nu.
                    </p>
                  )}
                </div>

                {movieResult.streamingLink && (
                  <a
                    href={movieResult.streamingLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      background: 'linear-gradient(180deg, #447ff5 0%, #3366cc 100%)',
                      color: 'white',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: '700',
                      marginBottom: '12px'
                    }}
                  >
                    Öppna streaminglänk
                  </a>
                )}

                {movieResult.notes.length > 0 && (
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.7)',
                    borderRadius: '10px',
                    padding: '12px',
                    marginBottom: '10px'
                  }}>
                    {movieResult.notes.map((note) => (
                      <p key={note} style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#4b5563' }}>
                        {note}
                      </p>
                    ))}
                  </div>
                )}

                {movieResult.relatedMovies?.length > 1 && (
                  <div style={{ marginBottom: '14px' }}>
                    <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '700', color: '#2f6fa3' }}>
                      Filmserie att jämföra
                    </p>
                    <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#64748b', lineHeight: '1.55' }}>
                      Hittade {movieResult.relatedMovies.length} träffar i samma serie eller närliggande filmer. Svep sidled och tryck på ett kort för mer info.
                    </p>
                    <div style={{
                      display: 'grid',
                      gridAutoFlow: 'column',
                      gridAutoColumns: 'minmax(195px, 225px)',
                      gap: '10px',
                      overflowX: 'auto',
                      paddingBottom: '4px'
                    }}>
                      {movieResult.relatedMovies.map((relatedMovie) => (
                        <FlipCard
                          key={`${relatedMovie.title}-${relatedMovie.year}`}
                          minHeight={226}
                          flipped={Boolean(flippedCards[`movie-related-${relatedMovie.title}-${relatedMovie.year}`])}
                          onToggle={() => toggleCardFlip(`movie-related-${relatedMovie.title}-${relatedMovie.year}`)}
                          front={(
                            <div style={{
                              background: '#fff',
                              border: '1px solid #dbe5ee',
                              borderRadius: '12px',
                              padding: '12px',
                              textAlign: 'left',
                              display: 'grid',
                              gap: '10px'
                            }}>
                              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                                {relatedMovie.poster ? (
                                  <img
                                    src={relatedMovie.poster}
                                    alt={relatedMovie.title}
                                    style={{
                                      width: '54px',
                                      height: '78px',
                                      borderRadius: '8px',
                                      objectFit: 'cover',
                                      flexShrink: 0
                                    }}
                                  />
                                ) : (
                                  <div style={{
                                    width: '54px',
                                    height: '78px',
                                    borderRadius: '8px',
                                    background: '#edf3f8',
                                    color: '#2f6fa3',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '10px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    flexShrink: 0
                                  }}>
                                    Ingen poster
                                  </div>
                                )}
                                <div style={{ minWidth: 0 }}>
                                  <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: '700', color: '#1f2937', lineHeight: '1.35' }}>{relatedMovie.title}</p>
                                  <p style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#6b7280' }}>{relatedMovie.year || 'År okänt'}</p>
                                  <div style={{ display: 'grid', gap: '4px' }}>
                                    <p style={{ margin: '0', fontSize: '11px', color: '#1f2937' }}>IMDb: <strong>{relatedMovie.imdbRating ?? 'Saknas'}</strong></p>
                                    <p style={{ margin: '0', fontSize: '11px', color: '#1f2937' }}>RT: <strong>{relatedMovie.rottenTomatoesRating ?? 'Saknas'}</strong></p>
                                  </div>
                                </div>
                              </div>
                              {relatedMovie.genre && (
                                <p style={{ margin: '0', fontSize: '11px', color: '#6b7280', lineHeight: '1.45' }}>{relatedMovie.genre}</p>
                              )}
                              <p style={{ margin: '0', fontSize: '10px', color: '#94a3b8', fontWeight: '700', letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                                Tryck för mer
                              </p>
                            </div>
                          )}
                          back={(
                            <div style={{
                              background: '#fff',
                              border: '1px solid #dbe5ee',
                              borderRadius: '12px',
                              padding: '12px',
                              textAlign: 'left',
                              display: 'grid',
                              gap: '8px',
                              alignContent: 'start',
                              height: '100%'
                            }}>
                              <div>
                                <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: '700', color: '#1f2937', lineHeight: '1.35' }}>{relatedMovie.title}</p>
                                <p style={{ margin: '0', fontSize: '11px', color: '#6b7280' }}>{relatedMovie.year || 'År okänt'}</p>
                              </div>
                              {relatedMovie.plot ? (
                                <p style={{ margin: '0', fontSize: '11px', color: '#475569', lineHeight: '1.55' }}>
                                  {getShortText(relatedMovie.plot, 185)}
                                </p>
                              ) : (
                                <p style={{ margin: '0', fontSize: '11px', color: '#94a3b8', lineHeight: '1.55' }}>
                                  Ingen extra handling hittades för just den här delen.
                                </p>
                              )}
                              <div style={{ display: 'grid', gap: '4px' }}>
                                <p style={{ margin: '0', fontSize: '11px', color: '#1f2937' }}>Genre: <strong>{relatedMovie.genre || 'Saknas'}</strong></p>
                                <p style={{ margin: '0', fontSize: '11px', color: '#1f2937' }}>IMDb: <strong>{relatedMovie.imdbRating ?? 'Saknas'}</strong></p>
                                <p style={{ margin: '0', fontSize: '11px', color: '#1f2937' }}>RT: <strong>{relatedMovie.rottenTomatoesRating ?? 'Saknas'}</strong></p>
                              </div>
                            </div>
                          )}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {isLoadingRelatedMovies && (
                  <div style={{
                    marginBottom: '14px',
                    background: '#f8fbff',
                    border: '1px solid #dbe5ee',
                    borderRadius: '12px',
                    padding: '12px 14px'
                  }}>
                    <p style={{ margin: '0', fontSize: '12px', color: '#64748b', lineHeight: '1.55' }}>
                      Hämtar fler delar i filmserien för jämförelse...
                    </p>
                  </div>
                )}

                <p style={{ margin: '0', fontSize: '11px', color: '#6b7280' }}>
                  Betyg via OMDb. Streamingdata via TMDB watch providers, powered by JustWatch.
                </p>
              </div>
            </div>
          </div>
        )}

        {!isBmiQuestion && answer && (
          <div style={{
            background: '#f4f7fb',
            borderRadius: '12px',
            padding: '25px',
            border: '1px solid #dbe5ee',
            borderLeft: '5px solid #2f6fa3'
          }}>
            {answerImage && (
              <img
                src={answerImage}
                alt={answerImageAlt || 'Illustration'}
                style={{
                  width: '100%',
                  maxHeight: '220px',
                  objectFit: 'contain',
                  background: '#fff',
                  borderRadius: '12px',
                  marginBottom: '16px',
                  padding: '10px',
                  boxSizing: 'border-box',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)'
                }}
              />
            )}
            <p style={{
              fontSize: '16px',
              lineHeight: '1.8',
              color: '#333',
              margin: '0',
              fontWeight: '400',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {answer}
            </p>
            {answerSourceLabel && (
              <p style={{
                margin: '14px 0 0 0',
                fontSize: '12px',
                color: '#6b7280',
                fontWeight: '600'
              }}>
                Källa: {answerSourceLabel}
              </p>
            )}
          </div>
        )}
        </div>
      </div>

      {showInfo && (
        <div onClick={closeInfoPanel} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(8, 15, 25, 0.62)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
          cursor: 'pointer',
          padding: '20px'
        }}>
          <div
            className={`info-sheet${showInfoBack ? ' is-flipped' : ''}`}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: '880px', height: 'min(86vh, 920px)', cursor: 'default' }}
          >
            <div className="info-sheet-inner">
              <div className="info-sheet-face info-sheet-front">
                <div style={{ ...infoSheetSurfaceStyle, background: 'linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                    <button onClick={closeInfoPanel} style={infoSheetActionButtonStyle}>Stäng</button>
                    <button onClick={() => setShowInfoBack(true)} style={{ ...infoSheetActionButtonStyle, background: '#1f4b78', color: '#fff', borderColor: '#1f4b78' }}>
                      Vänd till tekniköversikt
                    </button>
                  </div>

                  <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <p style={{ fontSize: '30px', fontWeight: '700', color: '#2f6fa3', margin: '0 0 10px 0' }}>Maxipedia</p>
                    <p style={{ fontSize: '17px', fontWeight: '700', color: '#1f4b78', margin: '0 0 8px 0' }}>
                      Allmänna frågor, film, elpriser och världskoll i ett samlat gränssnitt
                    </p>
                    <p style={{ maxWidth: '620px', margin: '0 auto', fontSize: '14px', color: '#5b6571', lineHeight: '1.65' }}>
                      Här får du en snabb översikt över hur appen är uppbyggd. Vänder du panelen får du den tekniska sidan med mer förklaring kring arkitektur, datakällor, UI-mönster och utvecklingsflöde.
                    </p>
                  </div>

                  <div style={modalOverviewGridStyle}>
                    {infoHighlights.map((item) => (
                      <div key={item.title} style={{
                        background: 'linear-gradient(180deg, #f7fbff 0%, #eef4fa 100%)',
                        border: '1px solid #dbe5ee',
                        borderRadius: '14px',
                        padding: '14px 14px 16px 14px',
                        textAlign: 'center',
                        minHeight: '126px',
                        display: 'grid',
                        gap: '6px',
                        alignContent: 'start',
                        boxSizing: 'border-box'
                      }}>
                        <p style={{
                          margin: '0',
                          fontSize: '10px',
                          fontWeight: '800',
                          color: '#64748b',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase'
                        }}>
                          {item.meta}
                        </p>
                        <p style={{ margin: '0', fontSize: '13px', fontWeight: '800', color: '#2f6fa3', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          {item.title}
                        </p>
                        <p style={{ margin: '0', color: '#475569', fontSize: '12px', lineHeight: '1.65' }}>
                          {item.text}
                        </p>
                      </div>
                    ))}
                  </div>

                </div>
              </div>

              <div className="info-sheet-face info-sheet-back">
                <div style={infoSheetSurfaceStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                    <button onClick={() => setShowInfoBack(false)} style={infoSheetActionButtonStyle}>Tillbaka till översikt</button>
                    <button onClick={closeInfoPanel} style={infoSheetActionButtonStyle}>Stäng</button>
                  </div>

                  <div style={{ textAlign: 'center', marginBottom: '22px' }}>
                    <p style={{ fontSize: '28px', fontWeight: '700', color: '#2f6fa3', margin: '0 0 8px 0' }}>Tekniköversikt</p>
                    <p style={{ maxWidth: '680px', margin: '0 auto', fontSize: '14px', color: '#55606c', lineHeight: '1.7' }}>
                      Panelen nedan visar de viktigaste byggstenarna bakom Maxipedia. Varje kort berättar både vad tekniken gör i appen och varför just den delen spelar roll för upplevelsen.
                    </p>
                  </div>

                  <div style={{ ...modalOverviewGridStyle, marginBottom: '18px' }}>
                    {infoHighlights.map((item) => (
                      <div key={`tech-overview-${item.title}`} style={{
                        background: 'linear-gradient(180deg, #f7fbff 0%, #eef4fa 100%)',
                        border: '1px solid #dbe5ee',
                        borderRadius: '14px',
                        padding: '14px 14px 16px 14px',
                        textAlign: 'center',
                        minHeight: '132px',
                        display: 'grid',
                        gap: '6px',
                        alignContent: 'start',
                        boxSizing: 'border-box'
                      }}>
                        <p style={{
                          margin: '0',
                          fontSize: '10px',
                          fontWeight: '800',
                          color: '#64748b',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase'
                        }}>
                          {item.meta}
                        </p>
                        <p style={{ margin: '0', fontSize: '13px', fontWeight: '800', color: '#2f6fa3', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          {item.title}
                        </p>
                        <p style={{ margin: '0', color: '#475569', fontSize: '12px', lineHeight: '1.65' }}>
                          {item.text}
                        </p>
                      </div>
                    ))}
                  </div>

                  <h3 style={infoSectionHeadingStyle}>Visuell teknikstack</h3>
                  <p style={infoSectionIntroStyle}>
                    Här syns de viktigaste tekniska valen bakom appen: hur gränssnittet renderas, hur data hämtas, varför vissa delar går via serverfunktioner och hur olika externa källor binds ihop till en enda startsida.
                  </p>
                  <div style={modalDetailGridStyle}>
                    {techHighlights.map((item) => (
                      <FlipCard
                        key={item.title}
                        minHeight={214}
                        flipped={Boolean(flippedCards[`tech-${item.title}`])}
                        onToggle={() => toggleCardFlip(`tech-${item.title}`)}
                        front={(
                          <div style={{ ...infoDetailCardFrontStyle, borderTop: '4px solid #2f6fa3' }}>
                            <p style={{ ...infoDetailCardTitleStyle, color: '#2f6fa3' }}>{item.title}</p>
                            <p style={infoDetailCardTextStyle}>{item.text}</p>
                            <p style={{ ...infoDetailCardTextStyle, color: '#687480', fontSize: '11px' }}>
                              Tryck för fördjupning och källänk
                            </p>
                          </div>
                        )}
                        back={(
                          <div style={{ ...infoDetailCardBackStyle, borderTop: '4px solid #2f6fa3' }}>
                            <p style={{ ...infoDetailCardTitleStyle, color: '#2f6fa3' }}>{item.title}</p>
                            <p style={infoDetailCardTextStyle}>{item.text}</p>
                            <p style={{ ...infoDetailCardTextStyle, lineHeight: '1.75' }}>{item.details}</p>
                            <a
                              href={item.learnMoreUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              style={{ ...infoSheetActionButtonStyle, justifySelf: 'center' }}
                            >
                              Läs vidare: {item.learnMoreLabel}
                            </a>
                          </div>
                        )}
                      />
                    ))}
                  </div>

                  <h3 style={infoSectionHeadingStyle}>Designmönster i appen</h3>
                  <p style={infoSectionIntroStyle}>
                    Utöver teknikvalen finns några tydliga produktmönster i gränssnittet. De gör att appen känns snabb, begriplig och lätt att använda trots att flera olika funktioner samsas på samma yta.
                  </p>
                  <div style={modalDetailGridStyle}>
                    {patternHighlights.map((item) => (
                      <FlipCard
                        key={item.title}
                        minHeight={198}
                        flipped={Boolean(flippedCards[`pattern-${item.title}`])}
                        onToggle={() => toggleCardFlip(`pattern-${item.title}`)}
                        front={(
                          <div style={{ ...infoDetailCardFrontStyle, borderTop: '4px solid #7aa5c7' }}>
                            <p style={{ ...infoDetailCardTitleStyle, color: '#1f4b78' }}>{item.title}</p>
                            <p style={infoDetailCardTextStyle}>{item.text}</p>
                            <p style={{ ...infoDetailCardTextStyle, color: '#687480', fontSize: '11px' }}>
                              Tryck för mer resonemang
                            </p>
                          </div>
                        )}
                        back={(
                          <div style={{ ...infoDetailCardBackStyle, borderTop: '4px solid #7aa5c7' }}>
                            <p style={{ ...infoDetailCardTitleStyle, color: '#1f4b78' }}>{item.title}</p>
                            <p style={infoDetailCardTextStyle}>{item.text}</p>
                            <p style={{ ...infoDetailCardTextStyle, lineHeight: '1.75' }}>{item.details}</p>
                          </div>
                        )}
                      />
                    ))}
                  </div>

                  <h3 style={infoSectionHeadingStyle}>Verktyg, AI och utvecklingsmiljö</h3>
                  <p style={infoSectionIntroStyle}>
                    Den här delen handlar mer om arbetsflödet runt koden än om själva runtime-arkitekturen. Här syns vilka verktyg som användes för att skriva, strukturera, kvalitetssäkra och deploya appen.
                  </p>
                  <div style={{ ...modalDetailGridStyle, marginBottom: '0' }}>
                    {toolingHighlights.map((item) => (
                      <FlipCard
                        key={item.title}
                        minHeight={198}
                        flipped={Boolean(flippedCards[`tool-${item.title}`])}
                        onToggle={() => toggleCardFlip(`tool-${item.title}`)}
                        front={(
                          <div style={{ ...infoDetailCardFrontStyle, borderTop: '4px solid #2f6fa3' }}>
                            <p style={{ ...infoDetailCardTitleStyle, color: '#2f6fa3' }}>{item.title}</p>
                            <p style={infoDetailCardTextStyle}>{item.text}</p>
                            <p style={{ ...infoDetailCardTextStyle, color: '#687480', fontSize: '11px' }}>
                              Tryck för kontext och roll i flödet
                            </p>
                          </div>
                        )}
                        back={(
                          <div style={{ ...infoDetailCardBackStyle, borderTop: '4px solid #2f6fa3' }}>
                            <p style={{ ...infoDetailCardTitleStyle, color: '#2f6fa3' }}>{item.title}</p>
                            <p style={infoDetailCardTextStyle}>{item.text}</p>
                            <p style={{ ...infoDetailCardTextStyle, lineHeight: '1.75' }}>{item.details}</p>
                          </div>
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      <div style={{
        ...sectionWrapperStyle,
        marginBottom: '30px',
        marginTop: '20px'
      }}>
        <div style={{
          textAlign: 'center',
          color: '#202122',
          marginBottom: '14px'
        }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '700', fontFamily: 'Georgia, "Times New Roman", serif' }}>Spotpris el per område</p>
          <p style={{ margin: '0', fontSize: '12px', color: '#54595d' }}>Visas i öre/kWh, exklusive moms, skatt och elnätsavgifter.</p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '12px',
          width: '100%'
        }}>
          {electricityCards.map((region) => {
            const change = getChangeDetails(region.today, region.yesterday)
            const changeSummary = change.delta !== null ? `${change.label} | ${change.percentLabel}` : 'Väntar på gårdagens värde'

            return (
              <FlipCard
                key={region.area}
                minHeight={284}
                flipped={Boolean(flippedCards[`spot-${region.area}`])}
                onToggle={() => toggleCardFlip(`spot-${region.area}`)}
                front={(
                  <div style={liveFlipCardFrontStyle}>
                    <div>
                      <div style={{ ...liveCardIconStyle, fontSize: '13px', letterSpacing: '0.04em' }}>
                        {region.area}
                      </div>
                      <p style={liveCardTitleStyle}>{region.name}</p>
                      <h3 style={liveCardValueStyle}>
                        {region.today !== null ? `${formatNumber(region.today, 2)} öre` : '—'}
                      </h3>
                      <p style={liveCardMetaStyle}>Dagens snitt i öre/kWh</p>
                    </div>
                    <div style={liveCardMetricGridStyle}>
                      <div style={liveCardMetricStyle}>
                        <p style={liveCardMetricLabelStyle}>I går</p>
                        <p style={liveCardMetricValueStyle}>
                          {region.yesterday !== null ? `${formatNumber(region.yesterday, 2)} öre` : '—'}
                        </p>
                      </div>
                      <div style={liveCardMetricStyle}>
                        <p style={liveCardMetricLabelStyle}>Imorgon</p>
                        <p style={liveCardMetricValueStyle}>
                          {region.tomorrow !== null ? `${formatNumber(region.tomorrow, 2)} öre` : '—'}
                        </p>
                      </div>
                    </div>
                    <div style={liveCardFooterGroupStyle}>
                      <p style={{ ...liveCardFooterStyle, color: change.color, fontWeight: '700' }}>{changeSummary}</p>
                      <p style={liveCardHintStyle}>Tryck för trend och dagsjämförelse</p>
                    </div>
                  </div>
                )}
                back={(
                  <div style={liveFlipCardBackStyle}>
                    <div>
                      <p style={liveCardTitleStyle}>{`${region.area} ${region.name}`}</p>
                      <div style={{ ...liveCardMetricGridStyle, gap: '8px', marginBottom: '10px' }}>
                        <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                          <p style={liveCardMetricLabelStyle}>I går</p>
                          <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{region.yesterday !== null ? `${formatNumber(region.yesterday, 2)} öre` : '—'}</p>
                        </div>
                        <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                          <p style={liveCardMetricLabelStyle}>I dag</p>
                          <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{region.today !== null ? `${formatNumber(region.today, 2)} öre` : '—'}</p>
                        </div>
                      </div>
                      <div style={{ ...liveCardMetricStyle, padding: '9px 10px', marginBottom: '10px' }}>
                        <p style={liveCardMetricLabelStyle}>Imorgon</p>
                        <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{region.tomorrow !== null ? `${formatNumber(region.tomorrow, 2)} öre` : '—'}</p>
                      </div>
                    </div>
                    <SparklineChart history={region.history} color="#2f6fa3" fill="rgba(47, 111, 163, 0.12)" />
                    <p style={{ ...liveCardFooterStyle, textAlign: 'center' }}>Senaste sju dagarnas medelpris. Tryck igen för framsidan.</p>
                  </div>
                )}
              />
            )
          })}
        </div>
      </div>

      <div style={{
        ...sectionWrapperStyle,
        marginBottom: '24px'
      }}>
        <div style={{
          textAlign: 'center',
          color: '#202122',
          marginBottom: '14px'
        }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '700', fontFamily: 'Georgia, "Times New Roman", serif' }}>Världskoll</p>
          <p style={{ margin: '0', fontSize: '12px', color: '#54595d' }}>Valutor, olja, väderduell och de senaste stora rubrikerna.</p>
        </div>

        <div style={{
          overflow: 'hidden',
          borderRadius: '12px',
          background: '#fff',
          border: '1px solid #d2dbe4',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
          marginBottom: '12px'
        }}>
          <div className="news-ticker-track" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '28px',
            padding: '12px 20px',
            whiteSpace: 'nowrap'
          }}>
            {(newsFlashItems.length > 0 ? [...newsFlashItems, ...newsFlashItems] : [
              { title: 'Nyhetsflash laddas...', link: '#', source: 'Flash' }
            ]).map((item, index) => (
              <a
                key={`${item.title}-${index}`}
                href={item.link}
                target={item.link !== '#' ? '_blank' : undefined}
                rel={item.link !== '#' ? 'noreferrer' : undefined}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  color: '#1f2937',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: '600'
                }}
              >
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '28px',
                  height: '28px',
                  borderRadius: '999px',
                  background: '#e8f0f8',
                  color: '#2f6fa3',
                  fontSize: '12px',
                  fontWeight: '700'
                }}>
                  N
                </span>
                <span>{item.title}</span>
                {item.source ? <span style={{ color: '#6b7280', fontSize: '11px' }}>{item.source}</span> : null}
              </a>
            ))}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
          width: '100%'
        }}>
          <div style={liveSectionCardStyle}>
            <p style={liveSectionTitleStyle}>Marknad</p>
            <div style={liveCardGridStyle}>
              {marketCards.map((item) => {
                const change = getChangeDetails(item.currentValue, item.previousValue)
                const changeSummary = change.delta !== null ? `${change.label} | ${change.percentLabel}` : 'Väntar på gårdagens värde'

                return (
                  <FlipCard
                    key={item.key}
                    minHeight={300}
                    flipped={Boolean(flippedCards[`market-${item.key}`])}
                    onToggle={() => toggleCardFlip(`market-${item.key}`)}
                    front={(
                      <div style={liveFlipCardFrontStyle}>
                        <div>
                          <div style={{ ...liveCardIconStyle, width: '36px', height: '36px', fontSize: item.key === 'brent' ? '12px' : '24px', fontWeight: '800', marginBottom: '6px' }}>
                            {item.symbol}
                          </div>
                          <p style={{ ...liveCardTitleStyle, marginBottom: '5px', lineHeight: '1.25' }}>{item.label}</p>
                          <h3 style={{ ...liveCardValueStyle, fontSize: '20px', marginBottom: '2px' }}>
                            {item.displayValue}
                          </h3>
                          <p style={liveCardMetaStyle}>{item.sublabel}</p>
                        </div>
                        <div style={liveCardMetricGridStyle}>
                          <div style={liveCardMetricStyle}>
                            <p style={liveCardMetricLabelStyle}>I går</p>
                            <p style={liveCardMetricValueStyle}>{item.previousDisplayValue}</p>
                          </div>
                          <div style={liveCardMetricStyle}>
                            <p style={liveCardMetricLabelStyle}>Förändring</p>
                            <p style={{ ...liveCardMetricValueStyle, color: change.color }}>{change.label}</p>
                          </div>
                        </div>
                        <div style={liveCardFooterGroupStyle}>
                          <p style={{ ...liveCardFooterStyle, color: change.color, fontWeight: '700' }}>{changeSummary}</p>
                          <p style={liveCardHintStyle}>{item.detailLines[0] ?? 'Tryck för mer marknadsdata'}</p>
                        </div>
                      </div>
                    )}
                    back={(
                      <div style={liveFlipCardBackStyle}>
                        <div>
                          <p style={{ ...liveCardTitleStyle, marginBottom: '8px' }}>{item.label}</p>
                          <div style={{ display: 'grid', gap: '6px', marginBottom: '10px' }}>
                            <div style={liveCardMetricStyle}>
                              <p style={liveCardMetricLabelStyle}>I dag</p>
                              <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{item.displayValue}</p>
                            </div>
                            <div style={liveCardMetricStyle}>
                              <p style={liveCardMetricLabelStyle}>I går</p>
                              <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{item.previousDisplayValue}</p>
                            </div>
                            <div style={liveCardMetricStyle}>
                              <p style={liveCardMetricLabelStyle}>Förändring</p>
                              <p style={{ ...liveCardMetricValueStyle, fontSize: '14px', color: change.color }}>{changeSummary}</p>
                            </div>
                          </div>
                        </div>
                        <SparklineChart history={item.history} color="#2f6fa3" fill="rgba(47, 111, 163, 0.14)" />
                        <div style={{ display: 'grid', gap: '4px' }}>
                          {item.detailLines.map((line) => (
                            <p key={line} style={liveCardFooterStyle}>{line}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  />
                )
              })}
            </div>
          </div>

          <div style={liveSectionCardStyle}>
            <p style={liveSectionTitleStyle}>Väderduell</p>
            <div style={liveCardGridStyle}>
              {weatherCards.map((location) => {
                const weatherSummary = [
                  Number.isFinite(location.precipitationProbability) ? `Regnrisk ${formatNumber(location.precipitationProbability, 0)}%` : null,
                  Number.isFinite(location.humidity) ? `Fukt ${formatNumber(location.humidity, 0)}%` : null
                ].filter(Boolean).join(' | ')

                return (
                <FlipCard
                  key={location.key}
                  minHeight={336}
                  flipped={Boolean(flippedCards[`weather-${location.key}`])}
                  onToggle={() => toggleCardFlip(`weather-${location.key}`)}
                  front={(
                    <div style={liveFlipCardFrontStyle}>
                      <div>
                        <div style={{ ...liveCardIconStyle, fontSize: '24px' }}>
                          {getWeatherSymbolFromCode(location.weatherCode)}
                        </div>
                        <p style={liveCardTitleStyle}>{location.name}</p>
                        <h3 style={liveCardValueStyle}>
                          {location && Number.isFinite(location.temperature) ? `${formatNumber(location.temperature)}°` : '—'}
                        </h3>
                        <p style={liveCardMetaStyle}>
                          {location?.description ?? 'Hämtar väder...'}
                        </p>
                      </div>
                      <div style={liveCardMetricGridStyle}>
                        <div style={liveCardMetricStyle}>
                          <p style={liveCardMetricLabelStyle}>Känns som</p>
                          <p style={liveCardMetricValueStyle}>
                            {location && Number.isFinite(location.apparentTemperature) ? `${formatNumber(location.apparentTemperature)}°` : '—'}
                          </p>
                        </div>
                        <div style={liveCardMetricStyle}>
                          <p style={liveCardMetricLabelStyle}>Vind</p>
                          <p style={liveCardMetricValueStyle}>
                            {location && Number.isFinite(location.windSpeed) ? `${formatNumber(location.windSpeed)} m/s` : '—'}
                          </p>
                        </div>
                      </div>
                      <div style={liveCardFooterGroupStyle}>
                        <p style={liveCardFooterStyle}>{weatherSummary || 'Fler väderdetaljer på baksidan'}</p>
                        <p style={liveCardHintStyle}>{weatherLocationDetails[location.key]?.region ?? ''}</p>
                      </div>
                    </div>
                  )}
                  back={(
                    <div style={{ ...liveFlipCardBackStyle, display: 'grid', gap: '8px', alignContent: 'start' }}>
                      <p style={{ ...liveCardTitleStyle, margin: '0' }}>{location.name}</p>
                      <p style={liveCardFooterStyle}>{weatherLocationDetails[location.key]?.region ?? ''}</p>
                      <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                        <p style={liveCardMetricLabelStyle}>Känns som</p>
                        <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>
                          {location && Number.isFinite(location.apparentTemperature) ? `${formatNumber(location.apparentTemperature)}°` : '—'}
                        </p>
                      </div>
                      <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                        <p style={liveCardMetricLabelStyle}>Dagens spann</p>
                        <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>
                          {location && Number.isFinite(location.minTemperature) && Number.isFinite(location.maxTemperature) ? `${formatNumber(location.minTemperature)}° / ${formatNumber(location.maxTemperature)}°` : '—'}
                        </p>
                      </div>
                      <div style={{ ...liveCardMetricGridStyle, gap: '8px' }}>
                        <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                          <p style={liveCardMetricLabelStyle}>Regnrisk</p>
                          <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{location && Number.isFinite(location.precipitationProbability) ? `${formatNumber(location.precipitationProbability, 0)}%` : '—'}</p>
                        </div>
                        <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                          <p style={liveCardMetricLabelStyle}>Vind</p>
                          <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{location && Number.isFinite(location.windSpeed) ? `${formatNumber(location.windSpeed)} m/s` : '—'}</p>
                        </div>
                      </div>
                      <div style={{ ...liveCardMetricGridStyle, gap: '8px' }}>
                        <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                          <p style={liveCardMetricLabelStyle}>UV max</p>
                          <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{location && Number.isFinite(location.uvIndexMax) ? formatNumber(location.uvIndexMax, 1) : '—'}</p>
                        </div>
                        <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                          <p style={liveCardMetricLabelStyle}>Luftfukt</p>
                          <p style={{ ...liveCardMetricValueStyle, fontSize: '14px' }}>{location && Number.isFinite(location.humidity) ? `${formatNumber(location.humidity, 0)}%` : '—'}</p>
                        </div>
                      </div>
                      <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                        <p style={liveCardMetricLabelStyle}>Sol upp / ner</p>
                        <p style={liveCardMetricValueStyle}>
                          {location?.sunrise ? new Date(location.sunrise).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '—'} / {location?.sunset ? new Date(location.sunset).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </p>
                      </div>
                      <div style={{ ...liveCardMetricStyle, padding: '9px 10px' }}>
                        <p style={liveCardMetricLabelStyle}>Lokal koll</p>
                        <p style={liveCardFooterStyle}>
                          {weatherLocationDetails[location.key]?.vibe ?? ''} {weatherLocationDetails[location.key]?.readout ?? ''}
                        </p>
                      </div>
                    </div>
                  )}
                />
                )
              })}
            </div>
            <div style={{
              marginTop: '12px',
              background: '#f4f7fb',
              border: '1px solid #dbe5ee',
              borderRadius: '12px',
              padding: '12px 14px',
              textAlign: 'center'
            }}>
              <p style={{ margin: '0', fontSize: '13px', fontWeight: '700', color: '#1f4b78', lineHeight: '1.6' }}>
                {getWeatherComparisonText(weatherComparison.ostersund, weatherComparison.marbella) || 'Hämtar jämförelsen mellan Östersund och Marbella...'}
              </p>
            </div>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              justifyContent: 'center',
              marginTop: '12px'
            }}>
              {weatherCards.map((location) => (
                <div key={`${location.key}-city-koll`} style={{
                  background: '#f4f7fb',
                  border: '1px solid #dbe5ee',
                  borderRadius: '999px',
                  padding: '9px 12px',
                  textAlign: 'left',
                  maxWidth: '420px'
                }}>
                  <p style={{ margin: '0', fontSize: '11px', color: '#1f2937', lineHeight: '1.45' }}>
                    <strong style={{ color: '#2f6fa3' }}>{location.name}.</strong>{' '}
                    {weatherLocationDetails[location.key]?.vibe ?? ''}{' '}
                    {weatherLocationDetails[location.key]?.readout ?? ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{
          marginTop: '12px',
          background: '#fff',
          border: '1px solid #d2dbe4',
          borderRadius: '12px',
          padding: '12px 16px',
          color: '#202122',
          textAlign: 'center'
        }}>
          <p style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '700', color: '#2f6fa3' }}>Senaste rubriker</p>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            justifyContent: 'center'
          }}>
            {(newsFlashItems.length > 0 ? newsFlashItems.slice(0, 6) : [{ title: 'Hämtar stora nyheter just nu...', link: '#', source: 'Flash' }]).map((item, index) => {
              const isClickable = item.link && item.link !== '#'

              return isClickable ? (
                <a
                  key={item.link}
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    maxWidth: '250px',
                    padding: '7px 11px',
                    borderRadius: '999px',
                    background: '#edf3f8',
                    color: '#2f6fa3',
                    textDecoration: 'none',
                    fontSize: '11px',
                    fontWeight: '600',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                </a>
              ) : (
                <span
                  key={`${item.title}-${index}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    maxWidth: '250px',
                    padding: '7px 11px',
                    borderRadius: '999px',
                    background: '#edf3f8',
                    color: '#2f6fa3',
                    fontSize: '11px',
                    fontWeight: '600',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                </span>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{
        marginTop: '22px',
        textAlign: 'center',
        color: '#54595d',
        fontSize: '14px',
        fontWeight: '500',
        opacity: 1
      }}>
        <p style={{ margin: '0' }}>
          {dateTime.toLocaleDateString('sv-SE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        <p style={{ margin: '5px 0 0 0', fontSize: '18px', fontWeight: '600', color: '#202122' }}>
          {dateTime.toLocaleTimeString('sv-SE')}
        </p>
      </div>
    </div>
  )
}

export default App


import { useState, useEffect } from 'react'

const LOCAL_OMDB_API_KEY = import.meta.env.VITE_OMDB_API_KEY?.trim()
const LOCAL_TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY?.trim()
const SPOT_PRICE_AREAS = ['SE1', 'SE2', 'SE3', 'SE4']
const SPOT_PRICE_TIME_ZONE = 'Europe/Stockholm'
const SPOT_PRICE_API_BASE_URL = 'https://www.elprisetjustnu.se/api/v1/prices'
const EXCHANGE_RATE_API_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=SEK,USD,GBP'
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
const WEATHER_LOCATIONS = [
  { key: 'ostersund', name: 'Östersund', latitude: 63.1792, longitude: 14.6357 },
  { key: 'marbella', name: 'Marbella', latitude: 36.5101, longitude: -4.8824 }
]

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

const fetchMovieDetailsFromServer = async (title) => {
  try {
    const params = new URLSearchParams({ title })
    const response = await fetch(`${MOVIE_API_PATH}?${params.toString()}`)
    const contentType = response.headers.get('content-type') ?? ''

    if (!contentType.includes('application/json')) {
      return null
    }

    return response.json()
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

  let bestMatch = null

  const searchVariants = [...new Set(titleHints.flatMap((titleHint) => getMovieSearchVariants(titleHint)))]

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
          getMovieTitleMatchScore(result?.Title, title),
          ...titleHints.map((titleHint) => getMovieTitleMatchScore(result?.Title, titleHint))
        )
      }))
      .filter((result) => result.score >= MOVIE_MATCH_SCORE_THRESHOLD)
      .sort((left, right) => right.score - left.score)[0] ?? null

    if (candidate && (!bestMatch || candidate.score > bestMatch.score)) {
      bestMatch = candidate
    }
  }

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
  const targetDate = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000)
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SPOT_PRICE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(targetDate).reduce((parts, part) => {
    if (part.type !== 'literal') {
      parts[part.type] = part.value
    }

    return parts
  }, {})

  return `${dateParts.year}/${dateParts.month}-${dateParts.day}`
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
  const payload = await fetchJson(EXCHANGE_RATE_API_URL)
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

const fetchWeatherForLocation = async ({ latitude, longitude, name, key }) => {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
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
    weatherCode: Number(payload?.current?.weather_code),
    description: getWeatherDescriptionFromCode(Number(payload?.current?.weather_code)),
    maxTemperature: Number(payload?.daily?.temperature_2m_max?.[0]),
    minTemperature: Number(payload?.daily?.temperature_2m_min?.[0]),
    precipitationProbability: Number(payload?.daily?.precipitation_probability_max?.[0] ?? 0)
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
  const [loading, setLoading] = useState(false)
  const [dateTime, setDateTime] = useState(new Date())
  const [showInfo, setShowInfo] = useState(false)
  const [exchangeRates, setExchangeRates] = useState({
    date: '',
    eurToSek: null,
    usdToSek: null,
    gbpToSek: null
  })
  const [oilPrice, setOilPrice] = useState({
    label: 'Brentolja',
    date: '',
    usdPerBarrel: null,
    sekPerBarrel: null
  })
  const [newsFlashItems, setNewsFlashItems] = useState([])
  const [weatherComparison, setWeatherComparison] = useState({
    ostersund: null,
    marbella: null
  })
  const [spotPrices, setSpotPrices] = useState({
    SE1: { today: null, tomorrow: null },
    SE2: { today: null, tomorrow: null },
    SE3: { today: null, tomorrow: null },
    SE4: { today: null, tomorrow: null }
  })

  const fetchSpotPrices = async () => {
    const areaEntries = await Promise.all(
      SPOT_PRICE_AREAS.map(async (area) => {
        try {
          const [today, tomorrow] = await Promise.all([
            fetchSpotPriceAverageForDate(area, 0),
            fetchSpotPriceAverageForDate(area, 1)
          ])

          return [area, { today, tomorrow }]
        } catch (error) {
          console.error(`Error fetching spot prices for ${area}:`, error)
          return [area, { today: null, tomorrow: null }]
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
        sekPerBarrel: worldHighlights?.oilPrice?.usdPerBarrel && rates.usdToSek
          ? worldHighlights.oilPrice.usdPerBarrel * rates.usdToSek
          : null
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
      setLoading(true)
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
        setLoading(false)
        return
      }

      const serverPayload = await fetchMovieDetailsFromServer(trimmedTitle)

      if (serverPayload) {
        if (serverPayload.ok && serverPayload.movie) {
          setMovieResult(serverPayload.movie)
          setLoading(false)
          return
        }

        setAnswer(serverPayload.error ?? 'Kunde inte hitta filmen. Kontrollera titeln och prova igen.')
        setLoading(false)
        return
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
        providers,
        hasStreamingOptions,
        streamingLink: tmdbMovie?.link ?? null,
        notes
      })
      setLoading(false)
    } catch (error) {
      console.error('Error fetching movie details:', error)
      setAnswer('Något gick fel vid hämtning av filmdata. Försök igen senare.')
      setMovieResult(null)
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
          maxWidth: '540px',
          width: '100%',
          position: 'relative'
        }}>
        <div style={{ position: 'absolute', top: '15px', right: '15px' }}>
          <button
            onClick={() => setShowInfo(!showInfo)}
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
          <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
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
              <span style={{ fontSize: '14px', fontWeight: '700' }}>Snabbfråga</span>
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '999px',
              background: questionType === 'bmi' ? '#eef5f1' : '#fff',
              color: '#202122',
              border: `1px solid ${questionType === 'bmi' ? '#4f8c6d' : '#d2dbe4'}`,
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
            <label style={{
              display: 'flex',
              alignItems: 'center',
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
                <p style={{ color: '#4f8c6d', fontSize: '14px', fontWeight: '600', margin: '0' }}>{bmiClassification}</p>
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

        {isMovieQuestion && movieResult && (
          <div style={{
            background: '#f1fbf4',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid #d9ebe0',
            borderLeft: '5px solid #2f855a',
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
                  background: 'linear-gradient(135deg, #d9ebe0 0%, #c4decf 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#2f855a',
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
                    {movieResult.year || 'Ar okant'}
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
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '700', color: '#2f855a' }}>
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
                      Ingen streaming eller butikstjanst hittades i Sverige just nu.
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
                      background: 'linear-gradient(135deg, #2f855a 0%, #276749 100%)',
                      color: 'white',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: '700',
                      marginBottom: '12px'
                    }}
                  >
                    Oppna streaminglank
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

                <p style={{ margin: '0', fontSize: '11px', color: '#6b7280' }}>
                  Betyg via OMDb. Streamingdata via TMDB watch providers, powered by JustWatch.
                </p>
              </div>
            </div>
          </div>
        )}

        {!isBmiQuestion && answer && (
          <div style={{
            background: '#f1fbf4',
            borderRadius: '12px',
            padding: '25px',
            border: '1px solid #d9ebe0',
            borderLeft: '5px solid #2f855a'
          }}>
            {answerImage && (
              <img
                src={answerImage}
                alt={answerImageAlt || 'Illustration'}
                style={{
                  width: '100%',
                  maxHeight: '240px',
                  objectFit: 'cover',
                  borderRadius: '12px',
                  marginBottom: '16px',
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

      {showInfo && (
        <div onClick={() => setShowInfo(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
          cursor: 'pointer',
          padding: '20px'
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #a2a9b1',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.18)',
            padding: 'clamp(22px, 4vw, 40px)',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '85vh',
            overflowY: 'auto',
            cursor: 'default'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
              <p style={{
                fontSize: '28px',
                fontWeight: '700',
                color: '#2f855a',
                margin: '0 0 10px 0'
              }}>Maxipedia</p>
              <p style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#276749',
                margin: '0'
              }}>Snabbfrågor, film, el, världskoll och nyhetsflash i ett kort</p>
              <p style={{
                fontSize: '13px',
                color: '#888',
                marginTop: '8px',
                fontStyle: 'italic'
              }}>Byggd för snabba vardagsbeslut och kul jämförelser</p>
            </div>

            <div style={{
              borderTop: '2px solid #f0f0f0',
              paddingTop: '25px'
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '22px'
              }}>
                <div style={{
                  background: '#f1fbf4',
                  padding: '14px',
                  borderRadius: '12px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: '#2f855a' }}>Det här kan du göra</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px', lineHeight: '1.6' }}>
                    Ställa generella frågor, söka på filmtitlar, kolla elpris, valuta, väder, Brentolja och senaste nyhetsflashen.
                  </p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '14px',
                  borderRadius: '12px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: '#2f855a' }}>Datakällor</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px', lineHeight: '1.6' }}>
                    Wikipedia, OMDb, TMDB, Elpriset just nu, Frankfurter, Open-Meteo, BBC RSS och Brent-data via Stooq.
                  </p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '14px',
                  borderRadius: '12px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: '#2f855a' }}>På Vercel</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px', lineHeight: '1.6' }}>
                    Filmdelen använder serverfunktioner så att OMDb- och TMDB-nycklar kan hållas privata i projektets environment variables.
                  </p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '14px',
                  borderRadius: '12px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: '#2f855a' }}>Tips</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px', lineHeight: '1.6' }}>
                    Testa svenska filmtitlar, felstavningar och korta faktasökningar. Världskoll uppdateras automatiskt när appen laddas.
                  </p>
                </div>
              </div>

              <h3 style={{
                fontSize: '18px',
                fontWeight: '700',
                color: '#333',
                marginBottom: '15px'
              }}>Teknik & komponenter</h3>
              
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                fontSize: '13px',
                lineHeight: '1.6'
              }}>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>React</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>UI-bibliotek för komponent-baserad arkitektur</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>React Hooks</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>useState och useEffect för state-management</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>JSX</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Syntaktisk extension för HTML i JavaScript</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>JavaScript ES6+</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Modern JavaScript med arrows, async/await</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>CSS Animations</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Ticker-rörelse och små hover-effekter i UI:t</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>CSS Gradients</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Linear gradients för visuell stil</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Flexbox & CSS Grid</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Layout-system för responsiv design</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Vercel Functions</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Server-side hämtning för filmdata, Brentolja och nyhetsflash</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Fetch API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Asynkrona HTTP-förfrågningar från internet</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Wikipedia REST API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Söker upp ämnen och hämtar korta sammanfattningar från Wikipedia</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Wikipedia Summary API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Ger kortare och mer konsekventa svar för generella frågor</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Node.js</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>JavaScript runtime-miljö</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>npm</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Package manager för JavaScript</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Vite</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Build tool för snabb utveckling</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>ESLint</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Kodkvalité och linting av JavaScript</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>BBC RSS & Stooq</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Ger nyhetsflash och Brentpris i världskoll-delen</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>DOM API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Manipulering av HTML-element</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Event Handling</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>onClick, onKeyDown, onMouseOver etc</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Async/Await</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Asynkron programmering för API-anrop</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>JSON</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Data-format från API-svar</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Template Literals</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Backtick-strings för dynamisk text</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Arrow Functions</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>{'(=>)'} Moderne funktionssyntax</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>State Management</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Hantering av komponent-tillstånd</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Side Effects</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>useEffect för data-hämtning</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Conditional Rendering</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Visa/göm UI baserat på state</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>CSS Transforms</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>translateX, translateY, rotate, scale</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>CSS Box Model</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Padding, margin, border, shadow</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Responsive Design</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>mobil-anpassad layout</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Z-Index & Stacking</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Lagring av element i 3D-perspektiv</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Position (Absolute/Fixed)</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Precis placering av element</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>String Interpolation</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Dynamisk strängkonstruktion</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Input Validation</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Kontroll av användarinmatning</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Date Object</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Hantering av datum och tid</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Locale Formatting</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>toLocaleTimeString, toLocaleDateString</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>setInterval/clearInterval</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Repeterad exekvering av kod</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>CORS</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Cross-Origin Resource Sharing</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Error Handling</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Try-catch och fallback-mekanismer</p>
                </div>
                <div style={{
                  background: '#f1fbf4',
                  padding: '12px',
                  borderRadius: '10px',
                  borderLeft: '4px solid #2f855a'
                }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Closures</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Funktioner som lagrar scope</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowInfo(false)}
              style={{
                width: '100%',
                marginTop: '25px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                color: 'white',
                background: 'linear-gradient(135deg, #2f855a 0%, #276749 100%)',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)'
                e.target.style.boxShadow = '0 6px 20px rgba(47, 133, 90, 0.4)'
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)'
                e.target.style.boxShadow = 'none'
              }}
            >
              Stäng
            </button>
          </div>
        </div>
      )}
      </div>

      <div style={{
        width: '100%',
        maxWidth: '900px',
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '12px',
          width: '100%'
        }}>
          {[
            { area: 'SE1', name: 'Luleå', today: spotPrices.SE1?.today, tomorrow: spotPrices.SE1?.tomorrow },
            { area: 'SE2', name: 'Sundsvall', today: spotPrices.SE2?.today, tomorrow: spotPrices.SE2?.tomorrow },
            { area: 'SE3', name: 'Stockholm', today: spotPrices.SE3?.today, tomorrow: spotPrices.SE3?.tomorrow },
            { area: 'SE4', name: 'Malmö', today: spotPrices.SE4?.today, tomorrow: spotPrices.SE4?.tomorrow }
          ].map((region) => (
            <div key={region.area} style={{
              background: '#fff',
              borderRadius: '12px',
              padding: '15px',
              textAlign: 'center',
              border: '1px solid #d2dbe4',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)'
            }}>
              <p style={{ fontSize: '13px', fontWeight: '700', color: '#3366cc', margin: '0 0 10px 0', whiteSpace: 'nowrap' }}>{`${region.area} ${region.name}`}</p>
              <div style={{ marginBottom: '8px' }}>
                <p style={{ fontSize: '11px', fontWeight: '600', color: '#888', margin: '0 0 3px 0' }}>Idag (medel)</p>
                <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#222', margin: '0' }}>
                  {region.today !== null ? region.today : '—'}
                </h3>
              </div>
              <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '8px' }}>
                <p style={{ fontSize: '11px', fontWeight: '600', color: '#888', margin: '0 0 3px 0' }}>Imorgon</p>
                <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#276749', margin: '0' }}>
                  {region.tomorrow !== null ? region.tomorrow : '—'}
                </h3>
              </div>
              <p style={{ fontSize: '10px', color: '#aaa', margin: '8px 0 0 0' }}>öre/kWh</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        width: '100%',
        maxWidth: '900px',
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '12px',
          width: '100%'
        }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.95)',
            borderRadius: '14px',
            padding: '16px',
            border: '1px solid #d2dbe4',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)'
          }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '800', color: '#2f6fa3', textAlign: 'center' }}>Marknad</p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '10px'
            }}>
              {[
                { key: 'eur', symbol: '€', label: 'EUR till SEK', value: exchangeRates.eurToSek !== null ? `${formatNumber(exchangeRates.eurToSek, 2)} kr` : '—', sublabel: '1 EUR' },
                { key: 'usd', symbol: '$', label: 'USD till SEK', value: exchangeRates.usdToSek !== null ? `${formatNumber(exchangeRates.usdToSek, 2)} kr` : '—', sublabel: '1 USD' },
                { key: 'gbp', symbol: '£', label: 'GBP till SEK', value: exchangeRates.gbpToSek !== null ? `${formatNumber(exchangeRates.gbpToSek, 2)} kr` : '—', sublabel: '1 GBP' },
                { key: 'brent', symbol: 'BRENT', label: oilPrice.label, value: oilPrice.usdPerBarrel !== null ? `${formatNumber(oilPrice.usdPerBarrel, 2)} USD` : '—', sublabel: oilPrice.sekPerBarrel !== null ? `≈ ${formatNumber(oilPrice.sekPerBarrel, 0)} kr/fat` : 'per fat' }
              ].map((item) => (
                <div key={item.key} style={{
                  background: '#f8fbff',
                  border: '1px solid #dbe5ee',
                  borderRadius: '12px',
                  padding: '14px 12px',
                  textAlign: 'center',
                  minWidth: 0
                }}>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '14px',
                    background: item.key === 'brent' ? '#eef5f1' : '#e8f0f8',
                    color: item.key === 'brent' ? '#4f8c6d' : '#2f6fa3',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: item.key === 'brent' ? '12px' : '24px',
                    fontWeight: '800',
                    margin: '0 auto 10px auto'
                  }}>
                    {item.symbol}
                  </div>
                  <p style={{ fontSize: '12px', fontWeight: '700', color: item.key === 'brent' ? '#4f8c6d' : '#2f6fa3', margin: '0 0 8px 0', whiteSpace: 'nowrap' }}>{item.label}</p>
                  <h3 style={{ fontSize: '22px', fontWeight: '700', color: '#222', margin: '0 0 4px 0', whiteSpace: 'nowrap' }}>
                    {item.value}
                  </h3>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: '0', whiteSpace: 'nowrap' }}>{item.sublabel}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.95)',
            borderRadius: '14px',
            padding: '16px',
            border: '1px solid #d2dbe4',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)'
          }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '800', color: '#4f8c6d', textAlign: 'center' }}>Väderduell</p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '10px'
            }}>
              {[
                weatherComparison.ostersund
                  ? weatherComparison.ostersund
                  : { key: 'ostersund', name: 'Östersund' },
                weatherComparison.marbella
                  ? weatherComparison.marbella
                  : { key: 'marbella', name: 'Marbella' }
              ].map((location) => (
                <div
                  key={location.key}
                  style={{
                    background: '#f9fcfa',
                    border: '1px solid #dbe9e1',
                    borderRadius: '12px',
                    padding: '14px 12px',
                    textAlign: 'center',
                    minWidth: 0
                  }}
                >
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '14px',
                    background: '#eef5f1',
                    color: '#4f8c6d',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    fontWeight: '700',
                    margin: '0 auto 10px auto'
                  }}>
                    {getWeatherSymbolFromCode(location.weatherCode)}
                  </div>
                  <p style={{ fontSize: '12px', fontWeight: '700', color: '#4f8c6d', margin: '0 0 8px 0', whiteSpace: 'nowrap' }}>{location.name}</p>
                  <h3 style={{ fontSize: '22px', fontWeight: '700', color: '#222', margin: '0 0 4px 0', whiteSpace: 'nowrap' }}>
                    {location && Number.isFinite(location.temperature) ? `${formatNumber(location.temperature)}°` : '—'}
                  </h3>
                  <p style={{ fontSize: '12px', color: '#4b5563', margin: '0 0 8px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {location?.description ?? 'Hämtar väder...'}
                  </p>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0', whiteSpace: 'nowrap' }}>
                    Känns som {location && Number.isFinite(location.apparentTemperature) ? `${formatNumber(location.apparentTemperature)}°` : '—'}
                  </p>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0', whiteSpace: 'nowrap' }}>
                    Idag {location && Number.isFinite(location.minTemperature) && Number.isFinite(location.maxTemperature) ? `${formatNumber(location.minTemperature)}° / ${formatNumber(location.maxTemperature)}°` : '—'}
                  </p>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0', whiteSpace: 'nowrap' }}>
                    Regnrisk {location && Number.isFinite(location.precipitationProbability) ? `${formatNumber(location.precipitationProbability, 0)}%` : '—'}
                  </p>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: '0', whiteSpace: 'nowrap' }}>
                    Vind {location && Number.isFinite(location.windSpeed) ? `${formatNumber(location.windSpeed)} m/s` : '—'}
                  </p>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: '12px',
              background: '#eef5f1',
              border: '1px solid #dbe9e1',
              borderRadius: '12px',
              padding: '12px 14px',
              textAlign: 'center'
            }}>
              <p style={{ margin: '0', fontSize: '13px', fontWeight: '700', color: '#355d48', lineHeight: '1.6' }}>
                {getWeatherComparisonText(weatherComparison.ostersund, weatherComparison.marbella) || 'Hämtar jämförelsen mellan Östersund och Marbella...'}
              </p>
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


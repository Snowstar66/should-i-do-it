/* global process */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const MOVIE_STREAMING_REGION = 'SE'
const WIKIPEDIA_SEARCH_LANGUAGES = ['sv', 'en']
const MOVIE_MATCH_SCORE_THRESHOLD = 72
const MOVIE_HINT_KEYWORDS = ['film', 'movie', 'filmer', 'movies', 'adventure film', 'fantasy film', 'action film']
const MAX_WIKIPEDIA_QUERY_VARIANTS = 2
const MAX_WIKIPEDIA_PAGES_PER_QUERY = 2
const MAX_OMDB_SEARCH_VARIANTS = 5
const MAX_RELATED_RESULTS = 6
const MOVIE_CACHE_TTL_MS = 1000 * 60 * 15
const EMPTY_MOVIE_PROVIDERS = {
  flatrate: [],
  free: [],
  ads: [],
  rent: [],
  buy: []
}
const execFileAsync = promisify(execFile)
const wikipediaHintCache = new Map()
const omdbMovieCache = new Map()
const tmdbStreamingCache = new Map()
const relatedMovieCache = new Map()

const getOmdbApiKey = () => process.env.OMDB_API_KEY?.trim() || process.env.VITE_OMDB_API_KEY?.trim() || ''
const getTmdbApiKey = () => process.env.TMDB_API_KEY?.trim() || process.env.VITE_TMDB_API_KEY?.trim() || ''

const sendJson = (response, statusCode, payload) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.status(statusCode).send(JSON.stringify(payload))
}

const stripHtmlTags = (value) => String(value ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const normalizeMovieTitle = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const getCacheValue = (cache, key) => {
  const cachedEntry = cache.get(key)

  if (!cachedEntry) {
    return null
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }

  return cachedEntry.value
}

const setCacheValue = (cache, key, value) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + MOVIE_CACHE_TTL_MS
  })
}

const isLocalIssuerCertificateError = (error) => {
  const directCode = error?.code
  const causeCode = error?.cause?.code

  return directCode === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || causeCode === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
}

const fetchTextWithCurl = async (url, headers = {}) => {
  const headerArgs = Object.entries(headers).flatMap(([key, value]) => ['-H', `${key}: ${value}`])
  const { stdout } = await execFileAsync('curl.exe', [
    '-L',
    '-A',
    'Maxipedia/1.0',
    ...headerArgs,
    url
  ], {
    maxBuffer: 1024 * 1024 * 2
  })

  return stdout
}

const getMovieYearNumber = (value) => {
  const match = String(value ?? '').match(/\d{4}/)

  return match ? Number(match[0]) : null
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

const fetchJson = async (url, options = {}) => {
  try {
    const response = await fetch(url, options)

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`)
    }

    return response.json()
  } catch (error) {
    if (process.platform !== 'win32' || !isLocalIssuerCertificateError(error)) {
      throw error
    }

    const text = await fetchTextWithCurl(url, options.headers ?? {})

    return JSON.parse(text)
  }
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

const fetchMovieTitleHintsFromWikipedia = async (title) => {
  const cacheKey = normalizeMovieTitle(title)
  const cachedValue = getCacheValue(wikipediaHintCache, cacheKey)

  if (cachedValue) {
    return cachedValue
  }

  const hints = []
  const queryVariants = getMovieSearchVariants(title).slice(0, MAX_WIKIPEDIA_QUERY_VARIANTS)
  const pageSearchTasks = WIKIPEDIA_SEARCH_LANGUAGES.flatMap((language) =>
    queryVariants.map(async (queryVariant) => {
      try {
        const pages = await searchWikipediaPages(queryVariant, language, MAX_WIKIPEDIA_PAGES_PER_QUERY)

        return pages.map((page) => ({ language, page }))
      } catch (error) {
        console.error(`Error fetching movie title hints from ${language} Wikipedia:`, error)
        return []
      }
    })
  )
  const pageSearchResults = (await Promise.all(pageSearchTasks)).flat()

  await Promise.all(pageSearchResults.map(async ({ language, page }) => {
    const titleScore = Math.max(
      getMovieTitleMatchScore(page?.title, title),
      getMovieTitleMatchScore(page?.matched_title, title),
      getMovieTitleMatchScore(stripHtmlTags(page?.excerpt), title)
    )

    if (titleScore < MOVIE_MATCH_SCORE_THRESHOLD) {
      return
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
      return
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
  }))

  const result = [...new Set(hints.filter(Boolean))].slice(0, 6)
  setCacheValue(wikipediaHintCache, cacheKey, result)

  return result
}

const mapOmdbMovieResponse = (payload, fallbackTitle) => ({
  title: payload?.Title ?? fallbackTitle,
  year: payload?.Year ?? '',
  plot: payload?.Plot && payload.Plot !== 'N/A' ? payload.Plot : '',
  genre: payload?.Genre && payload.Genre !== 'N/A' ? payload.Genre : '',
  poster: payload?.Poster && payload.Poster !== 'N/A' ? payload.Poster : '',
  imdbRating: payload?.imdbRating && payload.imdbRating !== 'N/A' ? payload.imdbRating : null,
  rottenTomatoesRating: payload?.Ratings?.find((rating) => rating?.Source === 'Rotten Tomatoes')?.Value ?? null
})

const getSeriesSearchRoots = (...titles) => {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'movie', 'film', 'del', 'och', 'den', 'det'])

  return [...new Set(
    titles
      .filter(Boolean)
      .flatMap((title) => {
        const cleanedTitle = String(title ?? '').replace(/\s+/g, ' ').trim()
        const normalizedWords = normalizeMovieTitle(cleanedTitle)
          .split(' ')
          .filter((word) => word && word.length > 2 && !stopWords.has(word))

        return [
          cleanedTitle,
          normalizedWords.slice(0, 2).join(' '),
          normalizedWords.slice(0, 3).join(' ')
        ]
      })
      .filter((entry) => entry && entry.length >= 3)
  )]
}

const findBestOmdbSearchCandidate = async (omdbApiKey, queryTitle, titleHints = [], maxVariants = MAX_OMDB_SEARCH_VARIANTS) => {
  let bestMatch = null
  const searchVariants = [...new Set(titleHints.flatMap((titleHint) => getMovieSearchVariants(titleHint)))]
    .slice(0, maxVariants)

  for (const variant of searchVariants) {
    const searchParams = new URLSearchParams({
      apikey: omdbApiKey,
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

const fetchMovieDetailsByImdbId = async (imdbID) => {
  const omdbApiKey = getOmdbApiKey()
  const cacheKey = `id:${imdbID}`
  const cachedValue = getCacheValue(omdbMovieCache, cacheKey)

  if (!imdbID) {
    return null
  }

  if (cachedValue) {
    return cachedValue
  }

  const detailsParams = new URLSearchParams({
    apikey: omdbApiKey,
    i: imdbID,
    plot: 'short',
    r: 'json'
  })
  const detailsResponse = await fetchOmdbMovieResponse(detailsParams)

  const result = detailsResponse ? mapOmdbMovieResponse(detailsResponse, detailsResponse?.Title ?? imdbID) : null

  if (result) {
    setCacheValue(omdbMovieCache, cacheKey, result)
  }

  return result
}

const fetchRelatedMoviesFromOmdb = async (searchTitle, primaryTitle) => {
  const omdbApiKey = getOmdbApiKey()
  const cacheKey = `${normalizeMovieTitle(searchTitle)}|${normalizeMovieTitle(primaryTitle)}`
  const cachedValue = getCacheValue(relatedMovieCache, cacheKey)

  if (!omdbApiKey) {
    return []
  }

  if (cachedValue) {
    return cachedValue
  }

  const searchRoots = getSeriesSearchRoots(searchTitle, primaryTitle).slice(0, 5)
  const candidateMap = new Map()

  const searchResponses = await Promise.all(searchRoots.map(async (searchRoot) => {
    const searchParams = new URLSearchParams({
      apikey: omdbApiKey,
      s: searchRoot,
      type: 'movie',
      r: 'json'
    })
    const searchResponse = await fetchOmdbMovieResponse(searchParams)

    return {
      searchRoot,
      searchResults: Array.isArray(searchResponse?.Search) ? searchResponse.Search : []
    }
  }))

  searchResponses.forEach(({ searchResults }) => {
    searchResults.forEach((result) => {
      const normalizedTitle = normalizeMovieTitle(result?.Title)
      const rootHit = searchRoots.some((root) => {
        const normalizedRoot = normalizeMovieTitle(root)

        return normalizedRoot && normalizedTitle.includes(normalizedRoot)
      })
      const score = Math.max(
        getMovieTitleMatchScore(result?.Title, searchTitle),
        getMovieTitleMatchScore(result?.Title, primaryTitle)
      ) + (rootHit ? 85 : 0)

      if (!rootHit && score < MOVIE_MATCH_SCORE_THRESHOLD) {
        return
      }

      const currentBest = candidateMap.get(result.imdbID)

      if (!currentBest || score > currentBest.score) {
        candidateMap.set(result.imdbID, {
          imdbID: result.imdbID,
          title: result.Title,
          year: result.Year,
          score
        })
      }
    })
  })

  const selectedCandidates = [...candidateMap.values()]
    .sort((left, right) => {
      const leftYear = getMovieYearNumber(left.year) ?? 0
      const rightYear = getMovieYearNumber(right.year) ?? 0

      if (leftYear !== rightYear) {
        return leftYear - rightYear
      }

      return right.score - left.score
    })
    .slice(0, MAX_RELATED_RESULTS)
  const detailedResults = (await Promise.all(
    selectedCandidates.map((candidate) => fetchMovieDetailsByImdbId(candidate.imdbID))
  )).filter(Boolean)

  setCacheValue(relatedMovieCache, cacheKey, detailedResults)

  return detailedResults
}

const fetchOmdbMovieResponse = async (params) => {
  const payload = await fetchJson(`https://www.omdbapi.com/?${params.toString()}`)

  return payload?.Response === 'False' ? null : payload
}

const fetchMovieRatingsFromOmdb = async (title) => {
  const omdbApiKey = getOmdbApiKey()
  const cacheKey = `title:${normalizeMovieTitle(title)}`
  const cachedValue = getCacheValue(omdbMovieCache, cacheKey)

  if (!omdbApiKey) {
    return null
  }

  if (cachedValue) {
    return cachedValue
  }

  const directExactMatchParams = new URLSearchParams({
    apikey: omdbApiKey,
    t: title,
    type: 'movie',
    plot: 'short',
    r: 'json'
  })
  const directExactMatch = await fetchOmdbMovieResponse(directExactMatchParams)

  if (directExactMatch) {
    const directResult = mapOmdbMovieResponse(directExactMatch, title)
    setCacheValue(omdbMovieCache, cacheKey, directResult)
    return directResult
  }

  const directSearchHints = [title]
  const directSearchMatch = await findBestOmdbSearchCandidate(omdbApiKey, title, directSearchHints, 3)

  if (directSearchMatch?.imdbID) {
    const directSearchResult = await fetchMovieDetailsByImdbId(directSearchMatch.imdbID)

    if (directSearchResult) {
      setCacheValue(omdbMovieCache, cacheKey, directSearchResult)
      return directSearchResult
    }
  }

  const titleHints = [...new Set([
    title,
    ...(await fetchMovieTitleHintsFromWikipedia(title))
  ])]

  for (const titleHint of titleHints) {
    const exactMatchParams = new URLSearchParams({
      apikey: omdbApiKey,
      t: titleHint,
      type: 'movie',
      plot: 'short',
      r: 'json'
    })
    const exactMatch = await fetchOmdbMovieResponse(exactMatchParams)

    if (exactMatch) {
      const exactResult = mapOmdbMovieResponse(exactMatch, titleHint)
      setCacheValue(omdbMovieCache, cacheKey, exactResult)
      return exactResult
    }
  }

  const bestMatch = await findBestOmdbSearchCandidate(omdbApiKey, title, titleHints, MAX_OMDB_SEARCH_VARIANTS)

  if (!bestMatch?.imdbID) {
    return null
  }

  const result = await fetchMovieDetailsByImdbId(bestMatch.imdbID)

  if (result) {
    setCacheValue(omdbMovieCache, cacheKey, result)
  }

  return result
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
  const tmdbApiKey = getTmdbApiKey()
  const searchParams = new URLSearchParams({
    api_key: tmdbApiKey,
    query: title,
    include_adult: 'false',
    language
  })

  if (year) {
    searchParams.set('year', String(year))
  }

  const searchResponse = await fetchJson(`https://api.themoviedb.org/3/search/movie?${searchParams.toString()}`)

  return Array.isArray(searchResponse?.results) ? searchResponse.results : []
}

const fetchMovieStreamingFromTmdb = async (title, year) => {
  const tmdbApiKey = getTmdbApiKey()
  const cacheKey = `${normalizeMovieTitle(title)}|${year ?? ''}`
  const cachedValue = getCacheValue(tmdbStreamingCache, cacheKey)

  if (!tmdbApiKey) {
    return null
  }

  if (cachedValue) {
    return cachedValue
  }

  let matchedMovie = null

  for (const language of ['sv-SE', 'en-US']) {
    for (const variant of getMovieSearchVariants(title).slice(0, 3)) {
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
    api_key: tmdbApiKey
  })
  const providersResponse = await fetchJson(`https://api.themoviedb.org/3/movie/${matchedMovie.id}/watch/providers?${providersParams.toString()}`)
  const regionalProviders = providersResponse?.results?.[MOVIE_STREAMING_REGION]

  const result = {
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

  setCacheValue(tmdbStreamingCache, cacheKey, result)

  return result
}

const getSetupErrorMessage = () => (
  'Filmkategorin behöver API-nycklar innan den kan användas.\n\n' +
  'På Vercel lägger du in detta under Project Settings -> Environment Variables:\n' +
  'OMDB_API_KEY=din_omdb_nyckel\n' +
  'TMDB_API_KEY=din_tmdb_nyckel'
)

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      error: 'Only GET is supported for this endpoint.'
    })
    return
  }

  const title = Array.isArray(request.query?.title)
    ? request.query.title[0]
    : String(request.query?.title ?? '').trim()
  const includeRelatedMovies = ['1', 'true', 'yes'].includes(String(request.query?.includeRelated ?? '').toLowerCase())
  const relatedOnly = ['1', 'true', 'yes'].includes(String(request.query?.relatedOnly ?? '').toLowerCase())

  if (!title) {
    sendJson(response, 400, {
      ok: false,
      error: 'Missing required query parameter: title'
    })
    return
  }

  try {
    const notes = []
    const addNote = (note) => {
      if (!notes.includes(note)) {
        notes.push(note)
      }
    }

    const omdbApiKey = getOmdbApiKey()
    const tmdbApiKey = getTmdbApiKey()

    if (!omdbApiKey && !tmdbApiKey) {
      sendJson(response, 200, {
        ok: false,
        code: 'MISSING_CONFIG',
        error: getSetupErrorMessage()
      })
      return
    }

    if (!omdbApiKey) {
      addNote('IMDb och Rotten Tomatoes visas så fort OMDB_API_KEY är ifylld.')
    }

    if (!tmdbApiKey) {
      addNote('Streaming visas så fort TMDB_API_KEY är ifylld.')
    }

    let omdbMovie = null
    let relatedMovies = []
    let tmdbMovie = null

    if (relatedOnly) {
      if (!omdbApiKey) {
        sendJson(response, 200, {
          ok: true,
          relatedMovies: []
        })
        return
      }

      try {
        omdbMovie = await fetchMovieRatingsFromOmdb(title)
        relatedMovies = await fetchRelatedMoviesFromOmdb(title, omdbMovie?.title ?? title)
      } catch (error) {
        console.error('Error fetching related movies:', error)
      }

      sendJson(response, 200, {
        ok: true,
        relatedMovies
      })
      return
    }

    if (omdbApiKey) {
      try {
        omdbMovie = await fetchMovieRatingsFromOmdb(title)

        if (includeRelatedMovies) {
          relatedMovies = await fetchRelatedMoviesFromOmdb(title, omdbMovie?.title ?? title)
        }
      } catch (error) {
        console.error('Error fetching movie ratings:', error)
        addNote('Kunde inte hämta filmbetyg just nu.')
      }
    }

    if (tmdbApiKey) {
      try {
        tmdbMovie = await fetchMovieStreamingFromTmdb(
          omdbMovie?.title ?? title,
          getMovieYearNumber(omdbMovie?.year)
        )
      } catch (error) {
        console.error('Error fetching movie streaming providers:', error)
        addNote('Kunde inte hämta streamingtjänster just nu.')
      }
    }

    if (!omdbMovie && !tmdbMovie) {
      sendJson(response, 200, {
        ok: false,
        code: 'NOT_FOUND',
        error: notes.length > 0
          ? `Kunde inte hämta filmdata.\n\n${notes.join('\n')}`
          : 'Kunde inte hitta filmen. Kontrollera titeln och prova igen.'
      })
      return
    }

    const providers = tmdbMovie?.providers ?? EMPTY_MOVIE_PROVIDERS
    const hasStreamingOptions = Object.values(providers).some((providerList) => providerList.length > 0)

    if (tmdbMovie && !hasStreamingOptions) {
      addNote('Ingen streaming eller butikstjänst hittades i Sverige just nu.')
    }

    sendJson(response, 200, {
      ok: true,
      movie: {
        title: omdbMovie?.title ?? tmdbMovie?.title ?? title,
        year: omdbMovie?.year ?? (tmdbMovie?.year ? String(tmdbMovie.year) : ''),
        plot: omdbMovie?.plot ?? '',
        genre: omdbMovie?.genre ?? '',
        poster: omdbMovie?.poster ?? '',
        imdbRating: omdbMovie?.imdbRating ?? null,
        rottenTomatoesRating: omdbMovie?.rottenTomatoesRating ?? null,
        relatedMovies,
        supportsRelatedMovies: Boolean(omdbApiKey),
        providers,
        hasStreamingOptions,
        streamingLink: tmdbMovie?.link ?? null,
        notes
      }
    })
  } catch (error) {
    console.error('Unhandled movie API error:', error)
    sendJson(response, 500, {
      ok: false,
      code: 'UNEXPECTED_ERROR',
      error: 'Något gick fel vid hämtning av filmdata. Försök igen senare.'
    })
  }
}

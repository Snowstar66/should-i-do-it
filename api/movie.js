/* global process */

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

const OMDB_API_KEY = process.env.OMDB_API_KEY?.trim() || process.env.VITE_OMDB_API_KEY?.trim()
const TMDB_API_KEY = process.env.TMDB_API_KEY?.trim() || process.env.VITE_TMDB_API_KEY?.trim()

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

const mapOmdbMovieResponse = (payload, fallbackTitle) => ({
  title: payload?.Title ?? fallbackTitle,
  year: payload?.Year ?? '',
  plot: payload?.Plot && payload.Plot !== 'N/A' ? payload.Plot : '',
  genre: payload?.Genre && payload.Genre !== 'N/A' ? payload.Genre : '',
  poster: payload?.Poster && payload.Poster !== 'N/A' ? payload.Poster : '',
  imdbRating: payload?.imdbRating && payload.imdbRating !== 'N/A' ? payload.imdbRating : null,
  rottenTomatoesRating: payload?.Ratings?.find((rating) => rating?.Source === 'Rotten Tomatoes')?.Value ?? null
})

const fetchOmdbMovieResponse = async (params) => {
  const response = await fetch(`https://www.omdbapi.com/?${params.toString()}`)

  if (!response.ok) {
    throw new Error(`OMDb request failed (${response.status})`)
  }

  const payload = await response.json()

  return payload?.Response === 'False' ? null : payload
}

const fetchMovieRatingsFromOmdb = async (title) => {
  if (!OMDB_API_KEY) {
    return null
  }

  const titleHints = [...new Set([
    title,
    ...(await fetchMovieTitleHintsFromWikipedia(title))
  ])]

  for (const titleHint of titleHints) {
    const exactMatchParams = new URLSearchParams({
      apikey: OMDB_API_KEY,
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
      apikey: OMDB_API_KEY,
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
    apikey: OMDB_API_KEY,
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
    api_key: TMDB_API_KEY,
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
  if (!TMDB_API_KEY) {
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
    api_key: TMDB_API_KEY
  })
  const providersResponse = await fetchJson(`https://api.themoviedb.org/3/movie/${matchedMovie.id}/watch/providers?${providersParams.toString()}`)
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

    if (!OMDB_API_KEY && !TMDB_API_KEY) {
      sendJson(response, 200, {
        ok: false,
        code: 'MISSING_CONFIG',
        error: getSetupErrorMessage()
      })
      return
    }

    if (!OMDB_API_KEY) {
      addNote('IMDb och Rotten Tomatoes visas så fort OMDB_API_KEY är ifylld.')
    }

    if (!TMDB_API_KEY) {
      addNote('Streaming visas så fort TMDB_API_KEY är ifylld.')
    }

    let omdbMovie = null
    let tmdbMovie = null

    if (OMDB_API_KEY) {
      try {
        omdbMovie = await fetchMovieRatingsFromOmdb(title)
      } catch (error) {
        console.error('Error fetching movie ratings:', error)
        addNote('Kunde inte hämta filmbetyg just nu.')
      }
    }

    if (TMDB_API_KEY) {
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

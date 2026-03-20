import { useState, useEffect } from 'react'

const LOCAL_OMDB_API_KEY = import.meta.env.VITE_OMDB_API_KEY?.trim()
const LOCAL_TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY?.trim()
const SPOT_PRICE_AREAS = ['SE1', 'SE2', 'SE3', 'SE4']
const SPOT_PRICE_TIME_ZONE = 'Europe/Stockholm'
const SPOT_PRICE_API_BASE_URL = 'https://www.elprisetjustnu.se/api/v1/prices'
const MOVIE_API_PATH = '/api/movie'
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
        sourceLabel: language === 'sv' ? 'Wikipedia' : 'English Wikipedia'
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

function App() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [questionType, setQuestionType] = useState('general')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [bmi, setBmi] = useState('')
  const [bmiClassification, setBmiClassification] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [age, setAge] = useState('')
  const [movieResult, setMovieResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dateTime, setDateTime] = useState(new Date())
  const [showInfo, setShowInfo] = useState(false)
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

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(new Date())
    }, 1000)
    const spotPriceTimer = setTimeout(() => {
      void fetchSpotPrices()
    }, 0)

    return () => {
      clearInterval(timer)
      clearTimeout(spotPriceTimer)
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

  const calculateAge = () => {
    if (!birthYear) {
      alert("Vänligen ange födelseår")
      return
    }
    const currentYear = new Date().getFullYear()
    const ageValue = currentYear - parseInt(birthYear)
    setAge(ageValue)
  }

  const fetchMovieDetails = async () => {
    try {
      setLoading(true)
      setAnswer('')
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
      const shortAnswer = await fetchShortAnswerFromWikipedia(question)

      if (shortAnswer) {
        setAnswer(`${shortAnswer.answer}\n\n— Källa: ${shortAnswer.sourceLabel}`)
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

    if (questionType === 'age') {
      calculateAge()
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
  const isAgeQuestion = questionType === 'age'
  const isMovieQuestion = questionType === 'movie'

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #2f855a 0%, #276749 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '20px',
      paddingTop: '40px',
      paddingBottom: '40px'
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
        <div style={{ fontSize: '60px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80px', position: 'relative' }}>
          <div>🐩</div>
        </div>
        <div style={{
          background: 'white',
          borderRadius: '20px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          padding: '50px',
          maxWidth: '500px',
          width: '100%',
          position: 'relative'
        }}>
        <div style={{ position: 'absolute', top: '15px', right: '15px', display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowInfo(!showInfo)}
            style={{
              background: 'linear-gradient(135deg, #2f855a 0%, #276749 100%)',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              color: 'white',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 12px rgba(47, 133, 90, 0.3)',
              padding: '0'
            }}
            onMouseOver={(e) => {
              e.target.style.boxShadow = '0 6px 16px rgba(47, 133, 90, 0.5)'
              e.target.style.transform = 'scale(1.1)'
            }}
            onMouseOut={(e) => {
              e.target.style.boxShadow = '0 4px 12px rgba(47, 133, 90, 0.3)'
              e.target.style.transform = 'scale(1)'
            }}
            title="Information"
          >
            ⓘ
          </button>
          <button
            onClick={() => {
              setQuestion('')
              setAnswer('')
              setQuestionType('general')
              setWeight('')
              setHeight('')
              setBmi('')
              setBmiClassification('')
              setBirthYear('')
              setAge('')
              setMovieResult(null)
              setLoading(false)
            }}
            style={{
              background: 'linear-gradient(135deg, #2f855a 0%, #276749 100%)',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              color: 'white',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 12px rgba(47, 133, 90, 0.3)',
              padding: '0'
            }}
            onMouseOver={(e) => {
              e.target.style.boxShadow = '0 6px 16px rgba(47, 133, 90, 0.5)'
              e.target.style.transform = 'rotate(180deg) scale(1.1)'
            }}
            onMouseOut={(e) => {
              e.target.style.boxShadow = '0 4px 12px rgba(47, 133, 90, 0.3)'
              e.target.style.transform = 'rotate(0deg) scale(1)'
            }}
            title="Nollställ allt"
          >
            ⟲
          </button>
        </div>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '700',
          color: '#222',
          marginBottom: '30px',
          margin: '0 0 30px 0'
        }}>Fråga något du vill veta</h1>

        <div style={{
          background: '#f1fbf4',
          borderRadius: '12px',
          padding: '15px',
          marginBottom: '20px'
        }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: '#555', margin: '0 0 12px 0' }}>Typ av fråga:</p>
          <div style={{ display: 'flex', gap: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="questionType"
                value="general"
                checked={questionType === 'general'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setBirthYear('')
                  setAge('')
                  setMovieResult(null)
                }}
                style={{ cursor: 'pointer', marginRight: '6px' }}
              />
              <span style={{ fontSize: '14px', color: '#555' }}>Generell</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="questionType"
                value="bmi"
                checked={questionType === 'bmi'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setBirthYear('')
                  setAge('')
                  setMovieResult(null)
                }}
                style={{ cursor: 'pointer', marginRight: '6px' }}
              />
              <span style={{ fontSize: '14px', color: '#555' }}>BMI</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="questionType"
                value="age"
                checked={questionType === 'age'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setBirthYear('')
                  setMovieResult(null)
                  setAge('')
                }}
                style={{ cursor: 'pointer', marginRight: '6px' }}
              />
              <span style={{ fontSize: '14px', color: '#555' }}>Ålder</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="questionType"
                value="movie"
                checked={questionType === 'movie'}
                onChange={(e) => {
                  setQuestionType(e.target.value)
                  setAnswer('')
                  setQuestion('')
                  setWeight('')
                  setHeight('')
                  setBmi('')
                  setBmiClassification('')
                  setBirthYear('')
                  setAge('')
                  setMovieResult(null)
                }}
                style={{ cursor: 'pointer', marginRight: '6px' }}
              />
              <span style={{ fontSize: '14px', color: '#555' }}>Film</span>
            </label>
          </div>
        </div>

        {(questionType === 'general' || isMovieQuestion) && (
        <input
          type="text"
          placeholder="Skriv din fråga..."
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value)
            setAnswer('')
            setWeight('')
            setHeight('')
            setBmi('')
            setBmiClassification('')
            setBirthYear('')
            setAge('')
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
            border: '2px solid #e0e0e0',
            borderRadius: '12px',
            boxSizing: 'border-box',
            transition: 'all 0.3s ease',
            outline: 'none',
            marginBottom: '20px'
          }}
          onFocus={(e) => e.target.style.borderColor = '#2f855a'}
          onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
        />
        )}

        {isBmiQuestion && (
          <div style={{
            background: '#f1fbf4',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <div style={{ marginBottom: '15px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#555',
                marginBottom: '8px'
              }}>Weight (kg)</label>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value === '' ? '' : parseFloat(e.target.value))}
                placeholder="Enter weight"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
              />
            </div>
            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#555',
                marginBottom: '8px'
              }}>Height (cm)</label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value === '' ? '' : parseFloat(e.target.value))}
                placeholder="Enter height"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
              />
            </div>
            {bmi && (
              <div style={{
                marginTop: '15px',
                padding: '15px',
                background: 'white',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <p style={{ color: '#888', fontSize: '12px', margin: '0 0 5px 0' }}>Your BMI</p>
                <h2 style={{ color: '#2f855a', fontSize: '36px', fontWeight: '700', margin: '0 0 10px 0' }}>{bmi}</h2>
                <p style={{ color: '#276749', fontSize: '14px', fontWeight: '600', margin: '0' }}>{bmiClassification}</p>
              </div>
            )}
          </div>
        )}

        {isAgeQuestion && (
          <div style={{
            background: '#f1fbf4',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: '#555',
              marginBottom: '8px'
            }}>Birth Year</label>
            <input
              type="number"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              placeholder="Enter birth year"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                boxSizing: 'border-box',
                outline: 'none',
                marginBottom: '15px'
              }}
            />
            {age && (
              <div style={{
                padding: '15px',
                background: 'white',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <p style={{ color: '#888', fontSize: '12px', margin: '0 0 5px 0' }}>Your Age</p>
                <h2 style={{ color: '#2f855a', fontSize: '36px', fontWeight: '700', margin: '0' }}>{age}</h2>
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
            background: 'linear-gradient(135deg, #2f855a 0%, #276749 100%)',
            border: 'none',
            borderRadius: '12px',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: '0 4px 15px rgba(47, 133, 90, 0.4)',
            marginBottom: '25px',
            opacity: loading ? 0.7 : 1
          }}
          onMouseOver={(e) => {
            if (!loading) {
              e.target.style.boxShadow = '0 6px 20px rgba(47, 133, 90, 0.6)'
              e.target.style.transform = 'translateY(-2px)'
            }
          }}
          onMouseOut={(e) => {
            e.target.style.boxShadow = '0 4px 15px rgba(47, 133, 90, 0.4)'
            e.target.style.transform = 'translateY(0)'
          }}
        >
          {loading ? 'Laddar...' : questionType === 'bmi' ? 'Beräkna BMI' : questionType === 'age' ? 'Beräkna ålder' : questionType === 'movie' ? 'Sök film' : 'Få svar'}
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

        {!isBmiQuestion && !isAgeQuestion && answer && (
          <div style={{
            background: '#f1fbf4',
            borderRadius: '12px',
            padding: '25px',
            border: '1px solid #d9ebe0',
            borderLeft: '5px solid #2f855a'
          }}>
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
            background: 'white',
            borderRadius: '20px',
            boxShadow: '0 30px 90px rgba(0, 0, 0, 0.4)',
            padding: '40px',
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
              }}>🎨 Pontus the Great</p>
              <p style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#276749',
                margin: '0'
              }}>AI Master Architect</p>
              <p style={{
                fontSize: '13px',
                color: '#888',
                marginTop: '8px',
                fontStyle: 'italic'
              }}>Designer av denna applikation</p>
            </div>

            <div style={{
              borderTop: '2px solid #f0f0f0',
              paddingTop: '25px'
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: '700',
                color: '#333',
                marginBottom: '15px'
              }}>🛠️ Teknik & Komponenter</h3>
              
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
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>CSS3 Animations</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>@keyframes för smooth visuell rörelse</p>
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
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>Web Audio API</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Skapar ljud-effekter programmatiskt</p>
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
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#2f855a' }}>VS Code</p>
                  <p style={{ margin: '0', color: '#555', fontSize: '12px' }}>Utvecklingsmiljö för kodning</p>
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
          color: 'white',
          marginBottom: '14px'
        }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '700' }}>Spotpris el per område</p>
          <p style={{ margin: '0', fontSize: '12px', opacity: 0.9 }}>Visas i öre/kWh, exklusive moms, skatt och elnätsavgifter.</p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr 1fr',
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
              background: 'rgba(255, 255, 255, 0.95)',
              borderRadius: '12px',
              padding: '15px',
              textAlign: 'center',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
              backdropFilter: 'blur(10px)'
            }}>
              <p style={{ fontSize: '13px', fontWeight: '700', color: '#2f855a', margin: '0 0 10px 0' }}>{region.name}</p>
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
        marginTop: '25px',
        textAlign: 'center',
        color: 'white',
        fontSize: '14px',
        fontWeight: '500',
        opacity: 0.9
      }}>
        <p style={{ margin: '0' }}>
          {dateTime.toLocaleDateString('sv-SE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        <p style={{ margin: '5px 0 0 0', fontSize: '18px', fontWeight: '600' }}>
          {dateTime.toLocaleTimeString('sv-SE')}
        </p>
      </div>
    </div>
  )
}

export default App


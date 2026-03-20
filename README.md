# React + Vite

## Movie Search Setup

The app now has a `Film` category that can show:

- IMDb rating
- Rotten Tomatoes rating
- where the movie is available to stream in Sweden

### Deploy on Vercel with private API keys

The movie feature is now designed to use a Vercel Function at `/api/movie`, which keeps your keys on the server instead of exposing them in the browser bundle.

In Vercel, add these Environment Variables in your project settings:

```bash
OMDB_API_KEY=your_omdb_api_key
TMDB_API_KEY=your_tmdb_api_key
```

After adding or changing them, redeploy the project.

### Local development

If you run the app locally with plain `npm run dev`, the movie feature can fall back to browser-side keys from `.env.local`:

```bash
VITE_OMDB_API_KEY=your_omdb_api_key
VITE_TMDB_API_KEY=your_tmdb_api_key
```

You can copy the included `.env.example` file and fill in only the values you need.

API sources used by the movie category:

- OMDb for movie metadata and ratings
- TMDB watch providers for streaming availability

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

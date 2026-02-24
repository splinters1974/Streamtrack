class APIService {
    constructor() {
        this.TMDB_KEY = '5e60db677e430c28859be07be92efaf2';
        this.OMDB_KEY = '78d3d8e7';

        this.baseURL = 'https://api.themoviedb.org/3';
        this.imageBase = 'https://image.tmdb.org/t/p/w500';
        this.backdropBase = 'https://image.tmdb.org/t/p/original';
        this.placeholderPoster = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='750'><rect width='500' height='750' fill='%231a1a1a'/><text x='250' y='380' text-anchor='middle' fill='%23444' font-size='18' font-family='sans-serif'>No Image</text></svg>`;
        this.placeholderBackdrop = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'><rect width='1280' height='720' fill='%231a1a1a'/></svg>`;

        this.freeUKServices = new Set(['BBC iPlayer', 'ITVX', 'All 4', 'My5', 'Channel 5']);

        // Cache so tab switching is instant (FIX #10)
        this.trendingCache = {};
        this.CACHE_TTL = 10 * 60 * 1000;
    }

    // FIX #1: normalise type so 'movies' and 'movie' both work
    normaliseType(type) {
        return (type === 'movies' || type === 'movie') ? 'movie' : 'tv';
    }

    async fetchWithCache(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if ('caches' in window) {
                const cache = await caches.open('api-cache');
                cache.put(url, new Response(JSON.stringify(data)));
            }
            return data;
        } catch (error) {
            if ('caches' in window) {
                const cache = await caches.open('api-cache');
                const cached = await cache.match(url);
                if (cached) return await cached.json();
            }
            throw error;
        }
    }

    async search(query, type = 'tv') {
        type = this.normaliseType(type);
        const endpoint = type === 'tv' ? 'search/tv' : 'search/movie';
        const url = `${this.baseURL}/${endpoint}?api_key=${this.TMDB_KEY}&query=${encodeURIComponent(query)}&language=en-GB&region=GB`;
        const data = await this.fetchWithCache(url);
        const topResults = data.results.slice(0, 10);

        return await Promise.all(topResults.map(async (item, index) => {
            const details = await this.getDetails(item.id, type);
            const ratings = await this.getRatings(item.id, type);
            const streaming = index < 5 ? await this.getWatchProviders(item.id, type) : [];
            return this.formatShowData(item, details, ratings, streaming, type);
        }));
    }

    async getDetails(id, type) {
        type = this.normaliseType(type);
        const endpoint = type === 'tv' ? `tv/${id}` : `movie/${id}`;
        const url = `${this.baseURL}/${endpoint}?api_key=${this.TMDB_KEY}&append_to_response=credits,keywords&language=en-GB`;
        return await this.fetchWithCache(url);
    }

    async getRatings(tmdbId, type) {
        type = this.normaliseType(type);
        try {
            const externalIds = await this.fetchWithCache(
                `${this.baseURL}/${type}/${tmdbId}/external_ids?api_key=${this.TMDB_KEY}`
            );
            if (!externalIds.imdb_id) return null;
            const data = await this.fetchWithCache(
                `https://www.omdbapi.com/?i=${externalIds.imdb_id}&apikey=${this.OMDB_KEY}`
            );
            if (data.Response === 'False') return null;
            return {
                imdb: data.imdbRating,
                imdbId: data.imdbID,
                rottenTomatoes: this.extractRTScore(data.Ratings),
                metacritic: data.Metascore
            };
        } catch (e) { return null; }
    }

    extractRTScore(ratings) {
        if (!ratings) return null;
        const rt = ratings.find(r => r.Source === 'Rotten Tomatoes');
        return rt ? rt.Value : null;
    }

    // FIX #7: Use TMDB's own free watch/providers endpoint — reliable, no RapidAPI needed
    async getWatchProviders(tmdbId, type) {
        type = this.normaliseType(type);
        try {
            const url = `${this.baseURL}/${type}/${tmdbId}/watch/providers?api_key=${this.TMDB_KEY}`;
            const data = await this.fetchWithCache(url);
            const gb = data.results?.GB;
            if (!gb) return [];

            const seen = new Set();
            const services = [];

            const add = (providers, streamType) => {
                (providers || []).forEach(p => {
                    if (seen.has(p.provider_name)) return;
                    seen.add(p.provider_name);
                    services.push({
                        name: p.provider_name,
                        logo: p.logo_path ? `https://image.tmdb.org/t/p/original${p.logo_path}` : null,
                        type: streamType,
                        country: 'UK',
                        free: this.freeUKServices.has(p.provider_name) || streamType === 'free',
                        color: this.getColorForProvider(p.provider_name),
                        url: gb.link || '#'
                    });
                });
            };

            add(gb.flatrate, 'subscription');
            add(gb.free, 'free');
            add(gb.rent, 'rent');
            add(gb.buy, 'buy');

            return services;
        } catch (e) {
            console.error('Watch providers error:', e);
            return [];
        }
    }

    getColorForProvider(name) {
        const map = {
            'Netflix': '#E50914', 'Amazon Prime Video': '#00A8E1',
            'Disney+': '#113CCF', 'BBC iPlayer': '#F54997',
            'ITVX': '#A020F0', 'All 4': '#F5A623',
            'My5': '#1F4E79', 'Now TV': '#003366',
            'Apple TV+': '#555555', 'Paramount+': '#0064FF',
            'BritBox': '#1B3D6E', 'Mubi': '#1C1C1C',
            'Shudder': '#1A1A2E', 'Sky Go': '#00375B',
            'Channel 5': '#1F4E79',
        };
        return map[name] || '#333';
    }

    async getTrending(type = 'tv') {
        type = this.normaliseType(type);
        const now = Date.now();
        if (this.trendingCache[type] && (now - this.trendingCache[type].ts) < this.CACHE_TTL) {
            return this.trendingCache[type].data;
        }

        const url = `${this.baseURL}/trending/${type}/week?api_key=${this.TMDB_KEY}&language=en-GB&region=GB`;
        const data = await this.fetchWithCache(url);

        const results = await Promise.all(data.results.slice(0, 20).map(async item => {
            const details = await this.getDetails(item.id, type);
            const ratings = await this.getRatings(item.id, type);
            return this.formatShowData(item, details, ratings, [], type);
        }));

        this.trendingCache[type] = { data: results, ts: now };
        return results;
    }

    async getShowByTmdbId(tmdbId, type) {
        type = this.normaliseType(type);
        const details = await this.getDetails(tmdbId, type);
        const ratings = await this.getRatings(tmdbId, type);
        const streaming = await this.getWatchProviders(tmdbId, type);
        return this.formatShowData(details, details, ratings, streaming, type);
    }

    // FIX #5: Real episode data per season from TMDB
    async getSeasonEpisodes(tmdbId, seasonNumber) {
        try {
            const url = `${this.baseURL}/tv/${tmdbId}/season/${seasonNumber}?api_key=${this.TMDB_KEY}&language=en-GB`;
            const data = await this.fetchWithCache(url);
            return (data.episodes || []).map(ep => ({
                number: ep.episode_number,
                title: ep.name,
                overview: ep.overview || 'No description available.',
                runtime: ep.runtime || null,
                airDate: ep.air_date,
                stillUrl: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null,
                rating: ep.vote_average ? ep.vote_average.toFixed(1) : null
            }));
        } catch (e) {
            return [];
        }
    }

    formatShowData(item, details, ratings, streaming, type) {
        type = this.normaliseType(type);
        const isTV = type === 'tv';
        return {
            id: `tmdb_${item.id}`,
            tmdb_id: item.id,
            type,
            title: isTV ? (item.name || item.title) : (item.title || item.name),
            synopsis: item.overview || details?.overview || '',
            poster_url: item.poster_path ? this.imageBase + item.poster_path : this.placeholderPoster,
            backdrop_url: item.backdrop_path ? this.backdropBase + item.backdrop_path : this.placeholderBackdrop,
            genres: details?.genres?.map(g => g.name) || [],
            year: isTV ? item.first_air_date?.substring(0, 4) : item.release_date?.substring(0, 4),
            total_seasons: isTV ? (details?.number_of_seasons || 1) : 1,
            total_episodes: isTV ? (details?.number_of_episodes || 1) : 1,
            runtime: !isTV ? details?.runtime : null,
            cast: details?.credits?.cast?.slice(0, 8).map(c => ({
                name: c.name,
                character: c.character,
                image: c.profile_path ? this.imageBase + c.profile_path : null
            })) || [],
            creators: isTV
                ? details?.created_by?.map(c => c.name)
                : details?.credits?.crew?.filter(c => c.job === 'Director').map(c => c.name),
            imdb_score: ratings?.imdb,
            rotten_tomatoes: ratings?.rottenTomatoes,
            metacritic: ratings?.metacritic,
            streaming,
            streaming_fetched_at: new Date().toISOString(),
            embedding: this.generateEmbedding(details)
        };
    }

    generateEmbedding(details) {
        if (!details) return [];
        return [
            ...(details.genres?.map(g => g.id) || []),
            ...(details.keywords?.results?.slice(0, 5).map(k => k.id) || [])
        ];
    }
}

const api = new APIService();

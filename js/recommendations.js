class RecommendationEngine {
    constructor() {
        this.db = db;
    }

    async getRecommendations(userId, type = 'tv', limit = 10) {
        type = api.normaliseType(type);
        const watched = await this.db.getUserShows(userId, 'completed', type);
        const watching = await this.db.getUserShows(userId, 'watching', type);
        const history = [...watched, ...watching];

        if (history.length === 0) {
            const trending = await api.getTrending(type);
            for (const show of trending) await this.db.saveShow(show);
            return trending;
        }

        const showDetails = (await Promise.all(history.map(h => this.db.getShow(h.show_id)))).filter(Boolean);

        // FIX #6: Merge user ratings into profile building
        const historyWithRatings = history.map(h => {
            const show = showDetails.find(s => s?.id === h.show_id);
            return show ? { ...show, userRating: h.personal_rating || null } : null;
        }).filter(Boolean);

        const userProfile = this.buildUserProfile(historyWithRatings);

        const allShows = await this.db.getAllFromIndexedDB('shows');
        const watchedIds = new Set(history.map(h => h.show_id));
        const candidates = allShows.filter(s => s.type === type && !watchedIds.has(s.id));

        if (candidates.length < limit) {
            const trending = await api.getTrending(type);
            for (const show of trending) {
                if (!watchedIds.has(show.id)) {
                    candidates.push(show);
                    await this.db.saveShow(show);
                }
            }
        }

        const scored = candidates
            .map(candidate => ({ show: candidate, score: this.calculateSimilarity(userProfile, candidate) }))
            .sort((a, b) => b.score - a.score);

        return scored.slice(0, limit).map(s => s.show);
    }

    buildUserProfile(shows) {
        const profile = { genres: {}, cast: {}, decades: {}, avgRuntime: 0, totalShows: shows.length };
        let totalRuntime = 0;

        shows.forEach(show => {
            // FIX #6: Weight by user rating — loved shows (4-5★) count 2x, disliked (1-2★) count 0.25x
            const ratingWeight = show.userRating
                ? (show.userRating >= 4 ? 2.0 : show.userRating >= 3 ? 1.0 : 0.25)
                : 1.0;

            show.genres?.forEach(genre => {
                profile.genres[genre] = (profile.genres[genre] || 0) + ratingWeight;
            });
            show.cast?.forEach(actor => {
                profile.cast[actor.name] = (profile.cast[actor.name] || 0) + ratingWeight;
            });
            if (show.year) {
                const decade = Math.floor(parseInt(show.year) / 10) * 10;
                profile.decades[decade] = (profile.decades[decade] || 0) + ratingWeight;
            }
            if (show.runtime) totalRuntime += show.runtime;
        });

        if (totalRuntime > 0) profile.avgRuntime = totalRuntime / shows.length;
        this.normalizeProfile(profile);
        return profile;
    }

    normalizeProfile(profile) {
        const normalize = (obj) => {
            const total = Object.values(obj).reduce((a, b) => a + b, 0);
            if (total === 0) return;
            Object.keys(obj).forEach(k => obj[k] = obj[k] / total);
        };
        normalize(profile.genres);
        normalize(profile.cast);
        normalize(profile.decades);
    }

    calculateSimilarity(profile, show) {
        let score = 0;
        let genreScore = 0;
        show.genres?.forEach(g => { if (profile.genres[g]) genreScore += profile.genres[g]; });
        score += genreScore * 0.4;

        let castScore = 0;
        show.cast?.forEach(a => { if (profile.cast[a.name]) castScore += profile.cast[a.name]; });
        score += Math.min(castScore, 1) * 0.2;

        if (show.year) {
            const decade = Math.floor(parseInt(show.year) / 10) * 10;
            if (profile.decades[decade]) score += profile.decades[decade] * 0.15;
        }
        if (show.imdb_score) {
            const r = parseFloat(show.imdb_score);
            if (r >= 8) score += 0.15;
            else if (r >= 7) score += 0.1;
            else if (r >= 6) score += 0.05;
        }
        if (show.year && parseInt(show.year) >= 2020) score += 0.1;
        return score;
    }

    async getBecauseYouWatched(userId, showId, limit = 10) {
        const sourceShow = await this.db.getShow(showId);
        if (!sourceShow) return [];
        const allShows = await this.db.getAllFromIndexedDB('shows');
        const candidates = allShows.filter(s => s.id !== showId && s.type === sourceShow.type);
        return candidates
            .map(show => ({ show, similarity: this.calculateShowSimilarity(sourceShow, show) }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit)
            .map(s => ({ ...s.show, reason: `Because you watched ${sourceShow.title}` }));
    }

    calculateShowSimilarity(show1, show2) {
        let similarity = 0;
        const genres1 = new Set(show1.genres || []);
        const genres2 = new Set(show2.genres || []);
        const gi = [...genres1].filter(g => genres2.has(g));
        const gu = Math.max(genres1.size, genres2.size);
        similarity += gu > 0 ? (gi.length / gu) * 0.5 : 0;

        const cast1 = new Set((show1.cast || []).map(c => c.name));
        const cast2 = new Set((show2.cast || []).map(c => c.name));
        const ci = [...cast1].filter(c => cast2.has(c));
        const cu = Math.max(cast1.size, cast2.size);
        similarity += cu > 0 ? (ci.length / cu) * 0.3 : 0;

        if (show1.year && show2.year) {
            const diff = Math.abs(parseInt(show1.year) - parseInt(show2.year));
            if (diff <= 2) similarity += 0.2;
            else if (diff <= 5) similarity += 0.1;
        }
        return similarity;
    }
}

const recommendations = new RecommendationEngine();

class OfflineManager {
    constructor() {
        this.syncInProgress = false;
    }

    async cacheImages(shows) {
        if (!('caches' in window)) return;
        const cache = await caches.open('image-cache');
        const imageUrls = shows.flatMap(show => [
            show.poster_url, show.backdrop_url,
            ...(show.cast?.map(c => c.image) || [])
        ]).filter(url => url && url.startsWith('http'));

        // FIX: use Promise.allSettled so one failure doesn't block the rest
        await Promise.allSettled(imageUrls.map(async url => {
            try {
                const exists = await cache.match(url);
                if (!exists) await cache.add(url);
            } catch (e) { /* silently skip uncacheable images */ }
        }));
    }

    isStreamingStale(show) {
        if (!show.streaming_fetched_at) return true;
        const days = (Date.now() - new Date(show.streaming_fetched_at)) / (1000 * 60 * 60 * 24);
        return days > 7;
    }

    async preloadForOffline(userId) {
        const myShows = await db.getUserShows(userId);
        const showDetails = (await Promise.all(myShows.map(s => db.getShow(s.show_id)))).filter(Boolean);

        await this.cacheImages(showDetails);

        for (const show of showDetails) {
            if (!show.streaming || this.isStreamingStale(show)) {
                try {
                    show.streaming = await api.getWatchProviders(show.tmdb_id, show.type);
                    show.streaming_fetched_at = new Date().toISOString();
                    await db.saveShow(show);
                } catch (e) { /* skip */ }
            }
        }

        return showDetails.length;
    }

    async isAvailableOffline(showId) {
        const show = await db.getShow(showId);
        if (!show) return false;
        if (!('caches' in window)) return true;
        const cache = await caches.open('image-cache');
        const posterCached = show.poster_url ? await cache.match(show.poster_url) : true;
        return posterCached !== undefined;
    }

    async getStorageUsage() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const { usage, quota } = await navigator.storage.estimate();
            return { usage, quota, percent: ((usage / quota) * 100).toFixed(2) };
        }
        return null;
    }

    async clearOldCaches() {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
            if (!['api-cache', 'image-cache'].includes(name)) await caches.delete(name);
        }
    }
}

const offlineManager = new OfflineManager();

const SUPABASE_URL = 'https://kmccjzlnyqecvpmtgoui.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttY2NqemxueXFlY3ZwbXRnb3VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NzQxNTUsImV4cCI6MjA4NzQ1MDE1NX0.-nEwmskCB9Z1GifiQgedBGUgiScsd-v_yg1VsqGe11Y';

class Database {
    constructor() {
        this.supabase = null;
        this.localDB = null;
        this.isOnline = navigator.onLine;
        this.initPromise = this.init();
    }

    async init() {
        this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        await this.initIndexedDB();
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('StreamTrackDB', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => { this.localDB = request.result; resolve(); };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('shows')) {
                    const s = db.createObjectStore('shows', { keyPath: 'id' });
                    s.createIndex('type', 'type', { unique: false });
                }
                if (!db.objectStoreNames.contains('userShows')) {
                    const u = db.createObjectStore('userShows', { keyPath: 'id' });
                    u.createIndex('user_id', 'user_id', { unique: false });
                    u.createIndex('status', 'status', { unique: false });
                }
                if (!db.objectStoreNames.contains('syncQueue')) {
                    db.createObjectStore('syncQueue', { keyPath: 'qid', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('recommendations')) {
                    db.createObjectStore('recommendations', { keyPath: 'user_id' });
                }
            };
        });
    }

    handleOnline() {
        this.isOnline = true;
        document.getElementById('offlineBanner')?.classList.remove('show');
        this.processSyncQueue();
    }

    handleOffline() {
        this.isOnline = false;
        document.getElementById('offlineBanner')?.classList.add('show');
    }

    async saveShow(showData) {
        await this.saveToIndexedDB('shows', showData);
        if (this.isOnline && this.supabase) {
            try {
                const { error } = await this.supabase.from('shows').upsert(showData);
                if (error) throw error;
            } catch (err) { await this.addToSyncQueue('saveShow', showData); }
        } else {
            await this.addToSyncQueue('saveShow', showData);
        }
    }

    async getShow(id) {
        const local = await this.getFromIndexedDB('shows', id);
        if (local) return local;
        if (this.isOnline && this.supabase) {
            const { data, error } = await this.supabase.from('shows').select('*').eq('id', id).single();
            if (!error && data) { await this.saveToIndexedDB('shows', data); return data; }
        }
        return null;
    }

    async updateUserShow(userId, showId, updates) {
        const record = {
            id: `${userId}_${showId}`,
            user_id: userId,
            show_id: showId,
            ...updates,
            updated_at: new Date().toISOString()
        };
        await this.saveToIndexedDB('userShows', record);
        if (this.isOnline && this.supabase) {
            try {
                const { error } = await this.supabase.from('user_shows').upsert(record);
                if (error) throw error;
            } catch (err) { await this.addToSyncQueue('updateUserShow', record); }
        } else {
            await this.addToSyncQueue('updateUserShow', record);
        }
        return record;
    }

    async getUserShows(userId, status = null, type = null) {
        let shows = await this.getAllFromIndexedDB('userShows', 'user_id', userId);
        if (status) shows = shows.filter(s => s.status === status);
        if (type) shows = shows.filter(s => s.type === api.normaliseType(type));
        return shows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }

    async removeUserShow(userId, showId) {
        const id = `${userId}_${showId}`;
        await this.deleteFromIndexedDB('userShows', id);
        if (this.isOnline && this.supabase) {
            await this.supabase.from('user_shows').delete().eq('id', id);
        }
    }

    async addToSyncQueue(operation, data) {
        await this.saveToSyncQueue({ operation, data, timestamp: new Date().toISOString(), retries: 0 });
    }

    saveToSyncQueue(item) {
        return new Promise((resolve, reject) => {
            const tx = this.localDB.transaction(['syncQueue'], 'readwrite');
            const store = tx.objectStore('syncQueue');
            const request = store.add(item);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async processSyncQueue() {
        const queue = await this.getAllFromIndexedDB('syncQueue');
        for (const item of queue) {
            try {
                if (item.operation === 'saveShow') await this.supabase.from('shows').upsert(item.data);
                else if (item.operation === 'updateUserShow') await this.supabase.from('user_shows').upsert(item.data);
                await this.deleteFromIndexedDB('syncQueue', item.qid);
            } catch (err) {
                item.retries = (item.retries || 0) + 1;
                if (item.retries < 3) setTimeout(() => this.saveToSyncQueue(item), Math.pow(4, item.retries) * 1000);
            }
        }
    }

    saveToIndexedDB(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.localDB.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    getFromIndexedDB(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this.localDB.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    getAllFromIndexedDB(storeName, indexName = null, value = null) {
        return new Promise((resolve, reject) => {
            const tx = this.localDB.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = indexName && value !== null
                ? store.index(indexName).getAll(value)
                : store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    deleteFromIndexedDB(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this.localDB.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async searchLocal(query, type = null) {
        const allShows = await this.getAllFromIndexedDB('shows');
        const lowerQuery = query.toLowerCase();
        let results = allShows.filter(show =>
            show.title?.toLowerCase().includes(lowerQuery) ||
            show.synopsis?.toLowerCase().includes(lowerQuery) ||
            show.genres?.some(g => g.toLowerCase().includes(lowerQuery))
        );
        if (type) results = results.filter(s => s.type === api.normaliseType(type));
        return results.slice(0, 20);
    }
}

const db = new Database();

const axios = require("axios");
const TB_BASE = "https://api.torbox.app/v1";

// --- Helper Match File (Adattato per struttura TB) ---
function matchFile(files, season, episode) {
    if (!files || !season || !episode) return null;
    const s = parseInt(season);
    const e = parseInt(episode);
    
    // TorBox files structure: { id, short_name, name, size, ... }
    const videoFiles = files.filter(f => /\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i.test(f.name) && !/sample/i.test(f.name));
    
    if (videoFiles.length === 0) return null;

    const regexStandard = new RegExp(`S0*${s}.*?E0*${e}\\b`, 'i');
    const regexX = new RegExp(`\\b${s}x0*${e}\\b`, 'i');
    
    let found = videoFiles.find(f => regexStandard.test(f.name));
    if (!found) found = videoFiles.find(f => regexX.test(f.name));
    
    return found ? found.id : null;
}

const TB = {
    getStreamLink: async (key, magnet, season = null, episode = null) => {
        try {
            // 1. Aggiungi Magnet
            // TorBox usa form-data o JSON. JSON è meglio.
            const createRes = await axios.post(`${TB_BASE}/api/torrents/create`, {
                magnet: magnet,
                seed: 1,
                allow_zip: false
            }, { headers: { Authorization: `Bearer ${key}` }});

            if (!createRes.data.success) return null;
            const torrentId = createRes.data.data.torrent_id;

            // 2. Get Info (Check if Cached/Done)
            // TorBox risponde quasi subito se è cached.
            // A volte bisogna aspettare un attimo, ma per stremio assumiamo cache istantanea.
            const infoRes = await axios.get(`${TB_BASE}/api/torrents/mylist?bypass_cache=true&id=${torrentId}`, {
                headers: { Authorization: `Bearer ${key}` }
            });
            
            const item = infoRes.data.data; // Torna oggetto singolo se ID specificato? O lista?
            // API v1 mylist ritorna array. Se passiamo ID, filtra? Controlliamo la risposta.
            // Solitamente TorBox mylist ritorna lista. Cerchiamo il nostro ID.
            const torrentData = Array.isArray(item) ? item.find(t => t.id === torrentId) : item;

            if (!torrentData || torrentData.download_state !== 'cached') {
                 return null; // Non cached
            }

            // 3. Seleziona File
            let fileId = null;
            if (season && episode && torrentData.files) {
                fileId = matchFile(torrentData.files, season, episode);
            }
            
            // Fallback: File più grande
            if (!fileId && torrentData.files) {
                const sorted = torrentData.files.sort((a, b) => b.size - a.size);
                if(sorted.length > 0) fileId = sorted[0].id;
            }

            if (!fileId) return null;

            // 4. Richiedi Link
            const linkRes = await axios.get(`${TB_BASE}/api/torrents/request_link?token=${key}&torrent_id=${torrentId}&file_id=${fileId}&zip_link=false`);

            if (linkRes.data.success) {
                return {
                    type: 'ready',
                    url: linkRes.data.data, // Il link diretto
                    filename: torrentData.name, // O nome del file
                    size: 0 // TorBox info size a volte è complessa da recuperare qui, ma non vitale
                };
            }
            return null;

        } catch (e) {
            console.error("TB Error:", e.message);
            return null;
        }
    }
};

module.exports = TB;

// rd.js - VERSIONE CHIRURGICA & REGEX AVANZATA (Anime/101 Support)
const axios = require("axios");
const RD_TIMEOUT = 120000;

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Helper AVANZATO per trovare il file giusto dentro il torrent
function matchFile(files, season, episode) {
    if (!files || !season || !episode) return null;

    // Convertiamo tutto in stringhe/numeri sicuri
    const s = parseInt(season);
    const e = parseInt(episode);
    const sStr = s.toString().padStart(2, '0');
    const eStr = e.toString().padStart(2, '0');

    // Filtriamo file video validi (evita .txt, .jpg, sample)
    const videoFiles = files.filter(f => {
        const name = f.path.toLowerCase();
        // Estensioni video comuni
        const isVideo = name.match(/\.(mkv|mp4|avi|mov|wmv|flv|webm)$/);
        // Escludi sample
        const notSample = !name.includes("sample");
        return isVideo && notSample;
    });

    if (videoFiles.length === 0) return null;

    // --- PRIORITÀ 1: Formato Standard (S01E01, S01 E01, s1e1) ---
    // Cerca "S01" seguito (anche non subito) da "E01"
    // \b assicura che E01 non matchi E010
    const regexStandard = new RegExp(`S0*${s}.*?E0*${e}\\b`, 'i');

    // --- PRIORITÀ 2: Formato "1x01" ---
    const regexX = new RegExp(`\\b${s}x0*${e}\\b`, 'i');

    // --- PRIORITÀ 3: Formato Compatto "101" (Stagione+Episodio) ---
    // Esempio: Stagione 1, Ep 1 -> Cerca "101". Stagione 2, Ep 15 -> Cerca "215"
    // Logica: (Start o non-numero) + Stagione + Episodio(pad2) + (non-numero o End)
    // Questo evita di matchare "1080" quando cerchiamo l'episodio "108"
    const compactNum = `${s}${eStr}`; 
    const regexCompact = new RegExp(`(^|\\D)${compactNum}(\\D|$)`);

    // --- PRIORITÀ 4: Formato "Episodio 01" o "Ep. 01" (Senza Stagione esplicita) ---
    const regexExplicitEp = new RegExp(`(ep|episode)[^0-9]*0*${e}\\b`, 'i');

    // --- PRIORITÀ 5: Formato Anime / Assoluto (Solo "01" o "- 01") ---
    // Molto rischioso, cerchiamo il numero circondato da spazi, parentesi o trattini
    // Es: "One Piece - 05.mkv" o "[Gruppo] Show - 05 [1080p].mkv"
    const regexAbsolute = new RegExp(`[ \\-\\[_]0*${e}[ \\-\\]_]`);


    // ESECUZIONE MATCHING
    let found = videoFiles.find(f => regexStandard.test(f.path));
    
    if (!found) found = videoFiles.find(f => regexX.test(f.path));
    
    // Check 101/215 solo se la stagione è < 100 (per evitare conflitti con anni strani)
    if (!found && s < 100) found = videoFiles.find(f => regexCompact.test(f.path));

    if (!found) found = videoFiles.find(f => regexExplicitEp.test(f.path));
    
    // Fallback disperato (Assoluto)
    if (!found) found = videoFiles.find(f => regexAbsolute.test(f.path));

    return found ? found.id : null;
}

async function rdRequest(method, url, token, data = null) {
    let attempt = 0;
    while (attempt < 4) {
        try {
            const config = {
                method,
                url,
                headers: { Authorization: `Bearer ${token}` },
                timeout: RD_TIMEOUT
            };
            if (data) config.data = data;
            const response = await axios(config);
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            if (status === 403) return null;
            if (status === 429 || status >= 500) {
                await sleep(1000 + Math.random() * 1000);
                attempt++;
                continue;
            }
            return null;
        }
    }
    return null;
}

const RD = {
    // 🗑️ Pulizia Torrent
    deleteTorrent: async (token, torrentId) => {
        try {
            const url = `https://api.real-debrid.com/rest/1.0/torrents/delete/${torrentId}`;
            await rdRequest('DELETE', url, token);
        } catch (e) {
            console.error(`⚠️ Errore pulizia torrent ${torrentId}:`, e.message);
        }
    },

    checkInstantAvailability: async (token, hashes) => {
        try {
            const hashString = hashes.join('/');
            const url = `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${hashString}`;
            return await rdRequest('GET', url, token) || {};
        } catch (e) { return {}; }
    },

    getStreamLink: async (token, magnet, season = null, episode = null) => {
        let torrentId = null; 
        try {
            // 1. Aggiungi Magnet
            const addUrl = "https://api.real-debrid.com/rest/1.0/torrents/addMagnet";
            const body = new URLSearchParams();
            body.append("magnet", magnet);
            
            const addRes = await rdRequest('POST', addUrl, token, body);
            if (!addRes || !addRes.id) return null;
            torrentId = addRes.id;

            // 2. Info Torrent
            let info = await rdRequest('GET', `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, token);
            if (!info) {
                await RD.deleteTorrent(token, torrentId);
                return null;
            }

            // 3. Seleziona File (Intelligente)
            if (info.status === 'waiting_files_selection') {
                let fileIdToSelect = "all";

                // Se abbiamo info su stagione/episodio, cerchiamo il file specifico
                if (season && episode && info.files) {
                    const matchedId = matchFile(info.files, season, episode);
                    if (matchedId) {
                        fileIdToSelect = matchedId;
                        console.log(`🎯 RD Match: Selezionato file ID ${matchedId} per S${season}E${episode}`);
                    }
                } else if (info.files) {
                     // Se è un film o non abbiamo info, prendiamo il file più grande (evita sample)
                     const sortedFiles = info.files.sort((a, b) => b.bytes - a.bytes);
                     if(sortedFiles.length > 0) fileIdToSelect = sortedFiles[0].id;
                }

                const selUrl = `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`;
                const selBody = new URLSearchParams();
                selBody.append("files", fileIdToSelect);
                await rdRequest('POST', selUrl, token, selBody);
                
                // Ricarica info dopo selezione
                info = await rdRequest('GET', `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, token);
            }

            // ⚠️ CONTROLLO CRUCIALE: Se non è 'downloaded', non è pronto per lo streaming.
            if (info.status !== 'downloaded') {
                await RD.deleteTorrent(token, torrentId);
                return null;
            }

            if (!info || !info.links?.length) {
                await RD.deleteTorrent(token, torrentId);
                return null;
            }

            // 4. Trova il link giusto
            const linkToUnrestrict = info.links[0]; 

            // 5. Unrestrict
            const unrestrictUrl = "https://api.real-debrid.com/rest/1.0/unrestrict/link";
            const unResBody = new URLSearchParams();
            unResBody.append("link", linkToUnrestrict);

            const unrestrictRes = await rdRequest('POST', unrestrictUrl, token, unResBody);
            
            if (!unrestrictRes) {
                await RD.deleteTorrent(token, torrentId);
                return null;
            }

            return {
                type: 'ready',
                url: unrestrictRes.download,
                filename: unrestrictRes.filename,
                size: unrestrictRes.filesize
            };
        } catch (e) { 
            console.error("RD Error:", e.message);
            if (torrentId) await RD.deleteTorrent(token, torrentId);
            return null; 
        }
    }
};

module.exports = RD;

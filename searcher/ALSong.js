/*
    ALSong Lyrics Searcher for ESLyric
    Zero-dependency implementation with smart ranking & scoring
*/

export function getConfig(cfg) {
    cfg.name = "ALSong";
    cfg.version = "1.0";
    cfg.author = "yhsphd";
}

export function getLyrics(meta, man) {
    if (meta.duration === 0) {
        return;
    }

    const url = "http://lyrics.alsong.co.kr/alsongwebservice/service1.asmx";

    const requestHeaders = {
        "Accept-Charset": "utf-8",
        "Content-Type": "application/soap+xml; charset=utf-8",
        "User-Agent": "gSOAP/2.7",
        "SOAPAction": "ALSongWebServer/GetResembleLyric2"
    };

    const encData = "8456ec35caba5c981e705b0c5d76e4593e020ae5e3d469c75d1c6714b6b1244c0732f1f19cc32ee5123ef7de574fc8bc6d3b6bd38dd3c097f5a4a1aa1b438fea0e413baf8136d2d7d02bfcdcb2da4990df2f28675a3bd621f8234afa84fb4ee9caa8f853a5b06f884ea086fd3ed3b4c6e14f1efac5a4edbf6f6cb475445390b0";

    const title = escapeXml(meta.title || "");
    const artist = escapeXml(meta.artist || "");

    const requestBody = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
    xmlns:SOAP-ENC="http://www.w3.org/2003/05/soap-encoding"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:ns1="ALSongWebServer">
    <SOAP-ENV:Body>
        <ns1:GetResembleLyric2>
            <ns1:encData>${encData}</ns1:encData>
            <ns1:stQuery>
                <ns1:strTitle>${title}</ns1:strTitle>
                <ns1:strArtistName>${artist}</ns1:strArtistName>
                <ns1:nCurPage>0</ns1:nCurPage>
            </ns1:stQuery>
        </ns1:GetResembleLyric2>
    </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

    const settings = {
        url: url,
        method: "POST",
        headers: requestHeaders,
        body: requestBody
    };

    request(settings, (err, res, body) => {
        if (err || res.statusCode !== 200 || !body) {
            return;
        }

        let candidates = [];
        try {
            candidates = parseAlsongXml(body);
        } catch (e) {
            log("parse exception: " + e.message);
            return;
        }

        if (!candidates || candidates.length === 0) {
            return;
        }

        // Calculate matching score and sort in descending order
        for (const candidate of candidates) {
            candidate.score = calculateScore(candidate, meta);
        }
        candidates.sort((a, b) => b.score - a.score);

        // Register sorted candidates to ESLyric manager
        for (const candidate of candidates) {
            if (man.checkAbort()) {
                return;
            }

            let lyricMeta = man.createLyric();
            lyricMeta.title = candidate.title;
            lyricMeta.artist = candidate.artist;
            lyricMeta.album = candidate.album;
            lyricMeta.lyricText = candidate.lyric;
            man.addLyric(lyricMeta);
        }
    });
}

function parseAlsongXml(xml) {
    const candidates = [];
    const itemRegex = /<ST_GET_RESEMBLELYRIC2_RETURN>([\s\S]*?)<\/ST_GET_RESEMBLELYRIC2_RETURN>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const infoId = getTagValue(block, "strInfoID");
        const title = decodeXml(getTagValue(block, "strTitle"));
        const artist = decodeXml(getTagValue(block, "strArtistName"));
        const album = decodeXml(getTagValue(block, "strAlbumName"));
        const rawLyric = getTagValue(block, "strLyric");

        candidates.push({
            id: infoId,
            title: title,
            artist: artist,
            album: album,
            lyric: normalizeLyric(rawLyric)
        });
    }

    return candidates;
}

function getTagValue(xmlBlock, tagName) {
    const regex = new RegExp("<" + tagName + "(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/" + tagName + ">", "i");
    const match = regex.exec(xmlBlock);
    return match ? match[1] : "";
}

function normalizeLyric(rawLyric) {
    if (!rawLyric) return "";
    return rawLyric
        .replace(/<br\s*\/?>|&lt;br\s*\/?&gt;/gi, "\n")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
}

function calculateScore(candidate, meta) {
    let score = 0;

    const targetTitle = normalizeForCompare(meta.title);
    const candTitle = normalizeForCompare(candidate.title);
    const targetArtist = normalizeForCompare(meta.artist);
    const candArtist = normalizeForCompare(candidate.artist);
    const targetAlbum = normalizeForCompare(meta.album);
    const candAlbum = normalizeForCompare(candidate.album);

    // 1. Title Similarity (max 45 points)
    if (targetTitle && candTitle) {
        if (targetTitle === candTitle) {
            score += 45;
        } else if (candTitle.includes(targetTitle) || targetTitle.includes(candTitle)) {
            score += 30;
        } else {
            score += Math.round(getStringSimilarity(targetTitle, candTitle) * 25);
        }
    }

    // 2. Artist Similarity (max 30 points)
    if (targetArtist && candArtist) {
        if (targetArtist === candArtist) {
            score += 30;
        } else if (candArtist.includes(targetArtist) || targetArtist.includes(candArtist)) {
            score += 20;
        } else {
            score += Math.round(getStringSimilarity(targetArtist, candArtist) * 15);
        }
    }

    // 3. Album Match (max 10 points)
    if (targetAlbum && candAlbum && targetAlbum === candAlbum) {
        score += 10;
    }

    // 4. Sync Lyric Quality (max 15 points)
    const timeTagMatches = candidate.lyric.match(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g);
    const timeTagCount = timeTagMatches ? timeTagMatches.length : 0;
    if (timeTagCount > 0) {
        score += 10; // Contains sync timestamps
        if (timeTagCount >= 10) {
            score += 5; // Good amount of sync lines
        }
    }

    return score;
}

function normalizeForCompare(str) {
    if (!str) return "";
    return str.toLowerCase().replace(/[\s\-_.,/\\()\[\]{}'"`!?:;]/g, "");
}

function getStringSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    if (s1.length < 2 || s2.length < 2) return 0;

    const bigrams = new Map();
    for (let i = 0; i < s1.length - 1; i++) {
        const pair = s1.substr(i, 2);
        bigrams.set(pair, (bigrams.get(pair) || 0) + 1);
    }

    let intersection = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        const pair = s2.substr(i, 2);
        const count = bigrams.get(pair) || 0;
        if (count > 0) {
            bigrams.set(pair, count - 1);
            intersection++;
        }
    }

    return (2.0 * intersection) / (s1.length - 1 + s2.length - 1);
}

function escapeXml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function decodeXml(str) {
    if (!str) return "";
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function log(str) {
    console.log("[alsong] " + str);
}
